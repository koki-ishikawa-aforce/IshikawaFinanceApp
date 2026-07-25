import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { TalkRoomIdSchema } from '../../shared/ids'

/**
 * 通知機能有効化イベント（08f §3）
 *
 * `talkRoomId` はテスト送信の配信先。発行側は世帯レベルの `SharedTalkRoom`（唯一の正、
 * OQ-55 ①）から取得する。per-user の通知機能有効化状態は共通トークルームID を持たない
 * （#334）ため、そちらを発行元にしてはならない。
 */
export const NotificationActivatedSchema = DomainEventBaseSchema.extend({
  type: z.literal('NotificationActivated'),
  talkRoomId: TalkRoomIdSchema,
  activatedAt: z.date(),
})
export type NotificationActivated = z.infer<typeof NotificationActivatedSchema>
