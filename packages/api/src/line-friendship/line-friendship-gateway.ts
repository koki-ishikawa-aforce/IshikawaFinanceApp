/**
 * LineFriendshipGateway の LINE Messaging API 実装（#297、OQ-55 ③）
 *
 * プロフィール照会 `GET /v2/bot/profile/{userId}` の応答を友だち状態へ翻訳する ACL 薄層。
 * LINE は「友だち未追加」「ブロック済み」のユーザーに対して 404 を返す。
 * Channel Access Token はマスタ管理の保管参照 → Parameter Store 復号で毎回解決し、
 * トークン実体を保持しない（push 送信の LineMessagingGateway と同じ経路）。
 *
 * 友だち状態の翻訳:
 *  - 200 → friend
 *  - 404 → not_friend
 *  - その他の HTTP エラー / ネットワーク断 / タイムアウト / トークン解決失敗 → unknown
 *
 * 404 以外を not_friend に倒さないのは、API 障害や通信断を根拠に「友だち未追加」を確定させ
 * ないため（確定させると、実際は友だちのユーザーが記録されないまま放置される）。
 *
 * detail には例外オブジェクトの中身を入れない。呼出し側がログへ出すため、Parameter Store の
 * パス等が落ちうる文字列を持ち込まない（routes/line-webhook.ts の鍵解決失敗ログと同じ方針）。
 */
import type { LineFriendshipGateway, LineFriendshipStatus, UserId } from '@warimaru/domain'

const LINE_PROFILE_ENDPOINT = 'https://api.line.me/v2/bot/profile'
const DEFAULT_TIMEOUT_MS = 10_000

export interface LineFriendshipGatewayConfig {
  /** Channel Access Token の解決（Phase0Config の保管参照 → Parameter Store 復号） */
  resolveChannelAccessToken: () => Promise<string>
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export function createLineFriendshipGateway(
  config: LineFriendshipGatewayConfig,
): LineFriendshipGateway {
  const fetchImpl = config.fetchImpl ?? fetch
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return {
    async checkFriendship(userId: UserId): Promise<LineFriendshipStatus> {
      let token: string
      try {
        token = await config.resolveChannelAccessToken()
      } catch (e) {
        return {
          kind: 'unknown',
          detail: `Channel Access Token の解決に失敗した（${e instanceof Error ? e.name : 'unknown'}）`,
        }
      }

      try {
        const response = await fetchImpl(`${LINE_PROFILE_ENDPOINT}/${encodeURIComponent(userId)}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (response.ok) return { kind: 'friend' }
        // 404 = 友だち未追加 / ブロック済み（LINE Messaging API のプロフィール照会仕様）
        if (response.status === 404) return { kind: 'not_friend' }
        return { kind: 'unknown', detail: `LINE profile API ${response.status}` }
      } catch (e) {
        const isTimeout =
          e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
        return {
          kind: 'unknown',
          detail: isTimeout
            ? 'LINE profile API がタイムアウトした'
            : `LINE profile API の呼び出しに失敗した（${e instanceof Error ? e.name : 'unknown'}）`,
        }
      }
    },
  }
}
