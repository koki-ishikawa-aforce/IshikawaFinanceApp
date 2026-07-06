import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { DeliveryMessageIdSchema, TalkRoomIdSchema } from '../../shared/ids'

/** テスト送信イベント（08g §3） */
export const TestMessageSentSchema = DomainEventBaseSchema.extend({
  type: z.literal('TestMessageSent'),
  deliveryMessageId: DeliveryMessageIdSchema,
  talkRoomId: TalkRoomIdSchema,
})
export type TestMessageSent = z.infer<typeof TestMessageSentSchema>
