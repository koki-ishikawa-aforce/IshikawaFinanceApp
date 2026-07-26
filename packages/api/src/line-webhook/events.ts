/**
 * LINE Webhook イベントの ACL（腐敗防止層）
 * @see docs/domain/08f-ul-オンボーディング認証.md §2「follow Webhook を受信する」「join Webhook を受信する」
 * @see docs/domain/03-open-questions.md OQ-55
 *
 * LINE Messaging API の Webhook payload を、割まるが扱う 2 つの意図
 * （友達追加 / 共通トークルーム参加）に翻訳する薄層。LINE 側の payload 形式が
 * ドメインへ漏れないよう、ここで branded ID に変換しきる。
 *
 * 受理するイベント種別は `follow` と `join` のみで、それ以外（message / unfollow /
 * leave / postback、および LINE Developers の「検証」ボタンが送るダミーイベント）は
 * 意図なしとして黙って読み飛ばす。将来 LINE がイベント種別やフィールドを追加しても
 * 受信自体が失敗しないよう、スキーマは未知のフィールドを許容する形にしている。
 */
import { z } from 'zod'
import { TalkRoomIdSchema, UserIdSchema } from '@warimaru/domain'
import type { LineTalkRoomKind, TalkRoomId, UserId } from '@warimaru/domain'

const LineWebhookSourceSchema = z.object({
  type: z.string().optional(),
  userId: z.string().optional(),
  groupId: z.string().optional(),
  roomId: z.string().optional(),
})

const LineWebhookEventSchema = z.object({
  type: z.string(),
  source: LineWebhookSourceSchema.optional(),
})

/**
 * LINE Webhook のリクエストボディ。
 *
 * イベント要素を `z.unknown()` で受けるのは、1 件でも想定外の形のイベントが混ざったときに
 * バッチ全体を 400 で落とさないため。LINE は at-least-once で再送するため、そこで例外にすると
 * 同じリクエストを恒久的に拒否し続け、同梱された正常なイベントも永久に処理できなくなる。
 * 個々のイベントの検証は `toLineWebhookIntents` が 1 件ずつ行う。
 */
export const LineWebhookRequestSchema = z.object({
  events: z.array(z.unknown()),
})
export type LineWebhookRequest = z.infer<typeof LineWebhookRequestSchema>

/** Webhook から読み取った、割まるが処理する意図 */
export type LineWebhookIntent =
  | { kind: 'friend_added'; userId: UserId }
  /**
   * `talkRoomKind` は在籍照会のエンドポイント選択に要る（グループと複数人トークで分かれる）。
   * ID だけでは種別を判別できないため、source の種別をここで確定させて後段へ渡す（#371）
   */
  | { kind: 'talk_room_joined'; talkRoomKind: LineTalkRoomKind; talkRoomId: TalkRoomId }

/**
 * 共通トークルームの種別とIDの取り出し。`join` の source は userId を含まず、
 * グループ（`group`）と複数人トーク（`room`）で ID のフィールド名が異なる。
 */
function talkRoomOf(
  source: z.infer<typeof LineWebhookSourceSchema>,
): { kind: LineTalkRoomKind; id: string | undefined } | undefined {
  if (source.type === 'group') return { kind: 'group', id: source.groupId }
  if (source.type === 'room') return { kind: 'room', id: source.roomId }
  return undefined
}

/**
 * Webhook リクエストを意図の列に翻訳する。
 *
 * 形が想定外のイベント・必要な ID を欠くイベント（LINE の仕様変更・検証用ダミー等）は
 * 意図に含めず読み飛ばす。ここで例外にすると、同じ内容で再送され続けるリクエストを
 * 永久に拒否し続けることになり、同じバッチに含まれる正常なイベントまで処理できなくなるため。
 */
export function toLineWebhookIntents(request: LineWebhookRequest): LineWebhookIntent[] {
  const intents: LineWebhookIntent[] = []
  for (const raw of request.events) {
    const parsed = LineWebhookEventSchema.safeParse(raw)
    if (!parsed.success) continue
    const event = parsed.data
    if (event.type === 'follow') {
      const userId = UserIdSchema.safeParse(event.source?.userId)
      if (userId.success) intents.push({ kind: 'friend_added', userId: userId.data })
      continue
    }
    if (event.type === 'join') {
      const talkRoom = talkRoomOf(event.source ?? {})
      if (talkRoom === undefined) continue
      const talkRoomId = TalkRoomIdSchema.safeParse(talkRoom.id)
      if (talkRoomId.success)
        intents.push({
          kind: 'talk_room_joined',
          talkRoomKind: talkRoom.kind,
          talkRoomId: talkRoomId.data,
        })
    }
  }
  return intents
}
