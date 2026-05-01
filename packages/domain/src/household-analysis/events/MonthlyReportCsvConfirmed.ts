import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { MonthlyReportIdSchema } from '../../shared/ids'

export const MonthlyReportCsvConfirmedSchema = DomainEventBaseSchema.extend({
  type: z.literal('MonthlyReportCsvConfirmed'),
  monthlyReportId: MonthlyReportIdSchema,
  csvConfirmedAt: z.date(),
})
export type MonthlyReportCsvConfirmed = z.infer<typeof MonthlyReportCsvConfirmedSchema>
