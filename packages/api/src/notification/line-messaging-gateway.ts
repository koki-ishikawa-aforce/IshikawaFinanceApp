/**
 * LineMessagingGateway の LINE Messaging API 実装（#36）
 *
 * ドメインの配信先・配信内容を LINE push API の payload へ翻訳する ACL 薄層。
 * Channel Access Token はマスタ管理の保管参照（Phase0Config.lineChannel.
 * channelAccessTokenRef）→ Parameter Store 復号で毎回解決し、トークン実体を
 * 保持しない（08g §2「LINE Channel設定値を取得する」）。
 *
 * 失敗理由の翻訳（SendFailureReason）:
 *  - タイムアウト → 'timeout'
 *  - HTTP 400（宛先・payload 不正） → 'invalid_target'
 *  - その他の HTTP エラー / ネットワーク断 / トークン解決失敗 → 'line_api_failure'
 */
import type {
  DeliveryContent,
  DeliveryTarget,
  LineMessagingGateway,
  LinePushOutcome,
} from '@warimaru/domain'
import { LineMessageIdSchema } from '@warimaru/domain'

const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push'
const DEFAULT_TIMEOUT_MS = 10_000
/** Flex Message の altText（通知一覧等でリッチカードの代わりに表示される要約文言） */
const FLEX_ALT_TEXT = '割まるからのお知らせ'

export interface LineMessagingGatewayConfig {
  /** Channel Access Token の解決（Phase0Config の保管参照 → Parameter Store 復号） */
  resolveChannelAccessToken: () => Promise<string>
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** 配信先 → LINE push API の `to`（トークルーム / ユーザーの LINE ID） */
function toRecipientId(target: DeliveryTarget): string {
  return target.kind === 'shared_talk_room' ? target.talkRoomId : target.userId
}

/** 配信内容 → LINE メッセージオブジェクト */
function toLineMessage(content: DeliveryContent): Record<string, unknown> {
  if (content.kind === 'plain_text') {
    const text =
      content.linkUrl !== undefined ? `${content.textBody}\n${content.linkUrl}` : content.textBody
    return { type: 'text', text }
  }
  // Flex Message の linkUrl は payload 内のアクション（button / uri）として呼出し側が
  // flexPayloadJson に埋め込む契約（08g: data Flex_Message配信内容 = Flex_payload AND リンクURL）。
  // ここで別メッセージとして送出はしない
  return {
    type: 'flex',
    altText: FLEX_ALT_TEXT,
    contents: JSON.parse(content.flexPayloadJson) as unknown,
  }
}

export function createLineMessagingGateway(
  config: LineMessagingGatewayConfig,
): LineMessagingGateway {
  const fetchImpl = config.fetchImpl ?? fetch
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return {
    async sendPush(target, content): Promise<LinePushOutcome> {
      const payload = { to: toRecipientId(target), messages: [toLineMessage(content)] }
      const sentPayloadJson = JSON.stringify(payload)

      let token: string
      try {
        token = await config.resolveChannelAccessToken()
      } catch (e) {
        return {
          sentPayloadJson,
          result: {
            kind: 'failure',
            failureReason: 'line_api_failure',
            detail: `Channel Access Token の解決に失敗: ${String(e)}`,
          },
        }
      }

      try {
        const response = await fetchImpl(LINE_PUSH_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: sentPayloadJson,
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (!response.ok) {
          const detail = `LINE push API ${response.status}: ${await response.text().catch(() => '')}`
          return {
            sentPayloadJson,
            result: {
              kind: 'failure',
              failureReason: response.status === 400 ? 'invalid_target' : 'line_api_failure',
              detail,
            },
          }
        }
        const body = (await response.json().catch(() => ({}))) as {
          sentMessages?: { id?: string }[]
        }
        return {
          sentPayloadJson,
          result: {
            kind: 'success',
            // 応答に id が無い場合の合成値は synthetic: 接頭辞でプロバイダ由来でないことを明示する
            // （配信ログは不変の監査レコードのため、本物の LINE message ID と区別できる形で凍結する）
            lineMessageId: LineMessageIdSchema.parse(
              body.sentMessages?.[0]?.id ?? 'synthetic:missing-line-message-id',
            ),
          },
        }
      } catch (e) {
        const isTimeout =
          e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
        return {
          sentPayloadJson,
          result: {
            kind: 'failure',
            failureReason: isTimeout ? 'timeout' : 'line_api_failure',
            detail: String(e),
          },
        }
      }
    },
  }
}
