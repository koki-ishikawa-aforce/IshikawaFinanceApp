import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { TalkRoomIdSchema } from '../../shared/ids'
import { YearMonthSchema } from '../../shared/value-objects/YearMonth'
import { ReminderStopReasonSchema } from '../value-objects/ReminderStopReason'

/** リマインダー停止イベント（08g §3。CSV 取込完了 or 通知無効化） */
export const ReminderStoppedSchema = DomainEventBaseSchema.extend({
  type: z.literal('ReminderStopped'),
  talkRoomId: TalkRoomIdSchema,
  targetMonth: YearMonthSchema,
  stopReason: ReminderStopReasonSchema,
})
export type ReminderStopped = z.infer<typeof ReminderStoppedSchema>
