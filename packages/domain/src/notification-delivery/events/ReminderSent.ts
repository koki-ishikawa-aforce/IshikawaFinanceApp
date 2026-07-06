import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { DeliveryMessageIdSchema, TalkRoomIdSchema } from '../../shared/ids'
import { YearMonthSchema } from '../../shared/value-objects/YearMonth'

/** リマインダー送信イベント（08g §3。CSV 取込リマインダー） */
export const ReminderSentSchema = DomainEventBaseSchema.extend({
  type: z.literal('ReminderSent'),
  deliveryMessageId: DeliveryMessageIdSchema,
  talkRoomId: TalkRoomIdSchema,
  targetMonth: YearMonthSchema,
})
export type ReminderSent = z.infer<typeof ReminderSentSchema>
