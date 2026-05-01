import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { MonthlyReportIdSchema, ExpenseReimbursementIdSchema } from '../../shared/ids'

export const MonthlyReportFinalizedSchema = DomainEventBaseSchema.extend({
  type: z.literal('MonthlyReportFinalized'),
  monthlyReportId: MonthlyReportIdSchema,
  finalizedAt: z.date(),
  expenseReimbursementId: ExpenseReimbursementIdSchema,
})
export type MonthlyReportFinalized = z.infer<typeof MonthlyReportFinalizedSchema>
