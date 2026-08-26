import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { DeliveryMessageIdSchema, TalkRoomIdSchema } from '../../shared/ids'

/**
 * テスト送信イベント（08g §3）
 *
 * `activatedAt` はオンボーディング・認証から借用する（referenced from: オンボーディング・認証）。
 * 配信確定（成功 or 冪等スキップ）のたびに、その根拠となった `NotificationActivated.activatedAt`
 * をそのまま運ぶ。世帯通知有効化記録（08f §1）を「配信が確定して初めて書く」ため（#590）の
 * 唯一の入力で、オンボーディング・認証側で改めて算出しない。
 */
export const TestMessageSentSchema = DomainEventBaseSchema.extend({
  type: z.literal('TestMessageSent'),
  deliveryMessageId: DeliveryMessageIdSchema,
  talkRoomId: TalkRoomIdSchema,
  activatedAt: z.date(),
})
export type TestMessageSent = z.infer<typeof TestMessageSentSchema>
