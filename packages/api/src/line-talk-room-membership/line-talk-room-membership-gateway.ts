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
 * timeoutMs は LINE への HTTP 呼び出し 1 回ごとと、Channel Access Token の解決に掛ける。
 * 本ゲートウェイは Webhook の応答パスから呼ばれるため、詰まると LINE 側がタイムアウトとみなして
 * 再送を始める。
 */
import type {
  LineTalkRoomKind,
  LineTalkRoomMembershipGateway,
  LineTalkRoomMembershipQuery,
  LineTalkRoomMembershipStatus,
} from '@warimaru/domain'
import { withTimeout } from '../with-timeout.js'

const LINE_API_BASE = 'https://api.line.me/v2/bot'
const DEFAULT_TIMEOUT_MS = 10_000

/** グループと複数人トークで在籍照会のパスが分かれる（LINE Messaging API の仕様） */
function membershipPathOf(kind: LineTalkRoomKind): string {
  return kind === 'group' ? 'group' : 'room'
}

export interface LineTalkRoomMembershipGatewayConfig {
  /** Channel Access Token の解決（Phase0Config の保管参照 → Parameter Store 復号） */
  resolveChannelAccessToken: () => Promise<string>
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export function createLineTalkRoomMembershipGateway(
  config: LineTalkRoomMembershipGatewayConfig,
): LineTalkRoomMembershipGateway {
  const fetchImpl = config.fetchImpl ?? fetch
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return {
    async checkMembership(
      query: LineTalkRoomMembershipQuery,
    ): Promise<LineTalkRoomMembershipStatus> {
      // 照会先が無ければ在籍を確かめようがない。not_member（＝第三者のトークルーム）と
      // 断定できる材料も無いため unknown を返し、記録するかの判断は呼出し側に委ねる
      if (query.userIds.length === 0) {
        return { kind: 'unknown', detail: '照会対象のアプリユーザーが登録されていない' }
      }

      let token: string
      try {
        token = await withTimeout(config.resolveChannelAccessToken(), timeoutMs)
      } catch (e) {
        const isTimeout = e instanceof Error && e.name === 'TimeoutError'
        return {
          kind: 'unknown',
          detail: isTimeout
            ? 'Channel Access Token の解決がタイムアウトした'
            : `Channel Access Token の解決に失敗した（${e instanceof Error ? e.name : 'unknown'}）`,
        }
      }

      const base = `${LINE_API_BASE}/${membershipPathOf(query.talkRoomKind)}/${encodeURIComponent(query.talkRoomId)}/member`
      // 404 以外の失敗を覚えておき、200 が 1 件も無かったときに not_member と区別する
      let failure: string | undefined
      for (const userId of query.userIds) {
        try {
          const response = await fetchImpl(`${base}/${encodeURIComponent(userId)}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(timeoutMs),
          })
          if (response.ok) return { kind: 'member' }
          // 404 = そのユーザーはこのトークルームに在籍していない（LINE Messaging API の仕様）
          if (response.status === 404) continue
          failure ??= `LINE member API ${response.status}`
        } catch (e) {
          const isTimeout =
            e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
          failure ??= isTimeout
            ? 'LINE member API がタイムアウトした'
            : `LINE member API の呼び出しに失敗した（${e instanceof Error ? e.name : 'unknown'}）`
        }
      }

      // 1 人でも判定できなかったなら「全員いない」とは言えない
      if (failure !== undefined) return { kind: 'unknown', detail: failure }
      return { kind: 'not_member' }
    },
  }
}
