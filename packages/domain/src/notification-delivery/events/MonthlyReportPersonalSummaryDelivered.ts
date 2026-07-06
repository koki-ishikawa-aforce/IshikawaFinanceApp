import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { DeliveryMessageIdSchema, MonthlyReportIdSchema, UserIdSchema } from '../../shared/ids'

/** 月次レポート個人サマリ配信イベント（08g §3。個人 DM） */
export const MonthlyReportPersonalSummaryDeliveredSchema = DomainEventBaseSchema.extend({
  type: z.literal('MonthlyReportPersonalSummaryDelivered'),
  deliveryMessageId: DeliveryMessageIdSchema,
  monthlyReportId: MonthlyReportIdSchema,
  userId: UserIdSchema,
})
export type MonthlyReportPersonalSummaryDelivered = z.infer<
  typeof MonthlyReportPersonalSummaryDeliveredSchema
>
