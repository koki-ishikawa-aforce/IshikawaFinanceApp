/**
 * LineTalkRoomMembershipGateway の LINE Messaging API 実装（#371、OQ-55 ①）
 *
 * 在籍照会 `GET /v2/bot/group/{groupId}/member/{userId}`（複数人トークは `/v2/bot/room/{roomId}/...`）
 * の応答を在籍状態へ翻訳する ACL 薄層。LINE は在籍していないユーザーに対して 404 を返す。
 * Channel Access Token はマスタ管理の保管参照 → Parameter Store 復号で毎回解決し、トークン実体を
 * 保持しない（友だち状態照会の LineFriendshipGateway と同じ経路）。
 *
 * 在籍状態の翻訳（世帯のユーザーを順に照会し、1 人でも在籍していれば在籍とみなす）:
 *  - いずれかが 200 → member（残りは照会しない）
 *  - 全員が 404 → not_member
 *  - 上記以外（その他の HTTP エラー / ネットワーク断 / タイムアウト / トークン解決失敗）が
 *    1 件でもあり、200 が無い → unknown
 *
 * 失敗を not_member に倒さないのは、API 障害や通信断を根拠に「夫婦のトークルームではない」を
 * 確定させないため。逆に、失敗を member に倒さないのは、確定させると第三者のトークルームが
 * 配信先として登録されうるため（照会を追加した目的そのものが失われる）。
 *
 * detail には例外オブジェクトの中身を入れない。呼出し側がログへ出すため、Parameter Store の
 * パス等が落ちうる文字列を持ち込まない。応答ボディ（displayName / pictureUrl は PII）も読まずに
 * 破棄する。トークルームID・LINE_userID も個人を辿れる識別子のため detail に含めない。
 *
 * timeoutMs は LINE への HTTP 呼び出し 1 回ごとと、Channel Access Token の解決に掛ける。さらに
 * 照会全体に totalTimeoutMs の締め切りを設ける。本ゲートウェイは Webhook の応答パスから呼ばれ、
 * トークン解決 + 人数分の逐次呼び出しが積み上がるため、1 回ごとの上限だけでは合計が伸びる
 * （詰まると LINE 側がタイムアウトとみなして再送を始める）。
 *
 * `unknown` の `retryable`: やり直せば結果が変わりうるものだけ true にする。
 *  - 5xx / 429 / タイムアウト / 通信断 / トークン解決失敗 → true（一時障害）
 *  - 401 / 403 などの権限・設定不備、識別子の異常 → false（やり直しても直らない）
 */
import type {
  LineTalkRoomKind,
  LineTalkRoomMembershipGateway,
  LineTalkRoomMembershipCheck,
  LineTalkRoomMembershipStatus,
} from '@warimaru/domain'
import { withTimeout } from '../with-timeout.js'

const LINE_API_BASE = 'https://api.line.me/v2/bot'
/** 1 回の外部呼び出しの上限。Webhook の応答パスなので、人が待つ登録パスより短くする */
const DEFAULT_TIMEOUT_MS = 5_000
/** 照会全体の締め切り。トークン解決 + 人数分の逐次呼び出しの合計に掛ける */
const DEFAULT_TOTAL_TIMEOUT_MS = 8_000

/**
 * URL パスへ載せる識別子の長さの上限。LINE のトークルームID・userID は 33 文字程度で、
 * `TalkRoomIdSchema` / `UserIdSchema` は長さを縛っていない。`encodeURIComponent` で
 * エスケープするためパス脱出は成立しないが、Webhook 本文由来の文字列を長さ無制限のまま
 * 外部 API の URL に載せない（実在の ID から十分に離した値にしてあり、通常は発火しない）。
 */
const MAX_LINE_ID_LENGTH = 200

/** グループと複数人トークで在籍照会のパスが分かれる（LINE Messaging API の仕様） */
function membershipPathOf(kind: LineTalkRoomKind): string {
  return kind === 'group' ? 'group' : 'room'
}

export interface LineTalkRoomMembershipGatewayConfig {
  /** Channel Access Token の解決（Phase0Config の保管参照 → Parameter Store 復号） */
  resolveChannelAccessToken: () => Promise<string>
  fetchImpl?: typeof fetch
  /** 外部呼び出し 1 回ごとの上限 */
  timeoutMs?: number
  /** 照会全体の締め切り（トークン解決 + 全ユーザー分の照会の合計） */
  totalTimeoutMs?: number
}

export function createLineTalkRoomMembershipGateway(
  config: LineTalkRoomMembershipGatewayConfig,
): LineTalkRoomMembershipGateway {
  const fetchImpl = config.fetchImpl ?? fetch
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const totalTimeoutMs = config.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS

  return {
    async checkMembership(
      check: LineTalkRoomMembershipCheck,
    ): Promise<LineTalkRoomMembershipStatus> {
      // 呼出し側（route）が照会前に弾く経路なので通常は通らない。ここで空配列をそのまま
      // ループに流すと「1 件も失敗しなかった」= not_member になってしまうため、保険として残す
      if (check.userIds.length === 0) {
        return {
          kind: 'unknown',
          retryable: false,
          detail: '照会対象のアプリユーザーが登録されていない',
        }
      }

      // 長さが外れる ID は在籍を確かめずに見送る。not_member（＝第三者のトークルーム）と
      // 断定はできないため unknown で返し、記録しない判断は呼出し側に揃える
      if (
        check.talkRoomId.length > MAX_LINE_ID_LENGTH ||
        check.userIds.some(userId => userId.length > MAX_LINE_ID_LENGTH)
      ) {
        return { kind: 'unknown', retryable: false, detail: '識別子の長さが想定の範囲を超えている' }
      }

      // 照会全体の締め切り。以降の各呼び出しには「1 回の上限」と「残り時間」の短い方を掛ける
      const deadline = Date.now() + totalTimeoutMs
      const remaining = (): number => deadline - Date.now()

      let token: string
      try {
        token = await withTimeout(
          config.resolveChannelAccessToken(),
          Math.min(timeoutMs, Math.max(remaining(), 1)),
        )
      } catch (e) {
        const isTimeout = e instanceof Error && e.name === 'TimeoutError'
        return {
          kind: 'unknown',
          // Parameter Store の遅延・一時障害はやり直しで直りうる
          retryable: true,
          detail: isTimeout
            ? 'Channel Access Token の解決がタイムアウトした'
            : `Channel Access Token の解決に失敗した（${e instanceof Error ? e.name : 'unknown'}）`,
        }
      }

      const base = `${LINE_API_BASE}/${membershipPathOf(check.talkRoomKind)}/${encodeURIComponent(check.talkRoomId)}/member`
      // 404 以外の失敗を覚えておき、200 が 1 件も無かったときに not_member と区別する
      let failure: { retryable: boolean; detail: string } | undefined
      for (const userId of check.userIds) {
        if (remaining() <= 0) {
          failure ??= { retryable: true, detail: '在籍照会が全体の制限時間を超えた' }
          break
        }
        try {
          const response = await fetchImpl(`${base}/${encodeURIComponent(userId)}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(Math.min(timeoutMs, Math.max(remaining(), 1))),
          })
          if (response.ok) return { kind: 'member' }
          // 404 = そのユーザーはこのトークルームに在籍していない（LINE Messaging API の仕様）
          if (response.status === 404) continue
          // 401 / 403 は Channel Access Token の権限・設定不備。やり直しても直らないので
          // 再送に回さず、設定を直すべきものとして呼出し側に伝える
          const isConfigError = response.status === 401 || response.status === 403
          failure ??= {
            retryable: !isConfigError,
            detail: isConfigError
              ? `LINE member API ${response.status}（Channel Access Token の権限・設定を確認する）`
              : `LINE member API ${response.status}`,
          }
        } catch (e) {
          const isTimeout =
            e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
          failure ??= {
            retryable: true,
            detail: isTimeout
              ? 'LINE member API がタイムアウトした'
              : `LINE member API の呼び出しに失敗した（${e instanceof Error ? e.name : 'unknown'}）`,
          }
        }
      }

      // 1 人でも判定できなかったなら「全員いない」とは言えない
      if (failure !== undefined) {
        return { kind: 'unknown', retryable: failure.retryable, detail: failure.detail }
      }
      return { kind: 'not_member' }
    },
  }
}
