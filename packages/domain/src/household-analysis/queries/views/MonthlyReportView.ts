import { z } from 'zod'
import {
  CommonMonthlyReportAttrsSchema,
  UnapprovedExpenseTransferSchema,
} from '../../aggregates/MonthlyReport'

export const MonthlyReportViewSchema = z.object({
  status: z.enum(['csv_confirmed', 'finalized']),
  common: CommonMonthlyReportAttrsSchema,
  csvConfirmedAt: z.date(),
  finalizedAt: z.date().nullable(),
  unapprovedTransfers: z.array(UnapprovedExpenseTransferSchema).nullable(),
})
export type MonthlyReportView = z.infer<typeof MonthlyReportViewSchema>
