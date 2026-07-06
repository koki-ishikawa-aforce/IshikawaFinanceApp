import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { DeliveryMessageIdSchema, MonthlyReportIdSchema, TalkRoomIdSchema } from '../../shared/ids'

/** 月次レポート世帯サマリ配信イベント（08g §3） */
export const MonthlyReportHouseholdSummaryDeliveredSchema = DomainEventBaseSchema.extend({
  type: z.literal('MonthlyReportHouseholdSummaryDelivered'),
  deliveryMessageId: DeliveryMessageIdSchema,
  monthlyReportId: MonthlyReportIdSchema,
  talkRoomId: TalkRoomIdSchema,
})
export type MonthlyReportHouseholdSummaryDelivered = z.infer<
  typeof MonthlyReportHouseholdSummaryDeliveredSchema
>
