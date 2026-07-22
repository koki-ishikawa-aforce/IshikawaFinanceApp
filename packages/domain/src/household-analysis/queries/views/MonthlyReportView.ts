import { z } from 'zod'
import { CommonMonthlyReportAttrsSchema } from '../../aggregates/MonthlyReport'
import { MoneySchema } from '../../../shared/value-objects/Money'
import { UnapprovedExpenseTransferSchema } from '../../../shared/value-objects/UnapprovedExpenseTransfer'

/**
 * 月次レポートビューの共通属性（viewer 視点で射影済み）。
 *
 * OQ-47: プライバシー3段階は Query/API 層で完全強制する。経費(会社)合計は本人のみ可視のため、
 * 集約が保持する businessExpenseTotalHoney / Darling を viewer 本人の 1 値
 * （businessExpenseTotalSelf）へ射影し、配偶者分は含めない（null 化ではなく除外）。
 * 個人合計（personalTotalHoney / Darling）は「合計のみ」ルールで両者可視のため双方保持する。
 */
export const MonthlyReportViewCommonSchema = CommonMonthlyReportAttrsSchema.omit({
  businessExpenseTotalHoney: true,
  businessExpenseTotalDarling: true,
}).extend({
  businessExpenseTotalSelf: MoneySchema,
})
export type MonthlyReportViewCommon = z.infer<typeof MonthlyReportViewCommonSchema>

export const MonthlyReportViewSchema = z.object({
  status: z.enum(['csv_confirmed', 'finalized']),
  common: MonthlyReportViewCommonSchema,
  csvConfirmedAt: z.date(),
  finalizedAt: z.date().nullable(),
  unapprovedTransfers: z.array(UnapprovedExpenseTransferSchema).nullable(),
})
export type MonthlyReportView = z.infer<typeof MonthlyReportViewSchema>
