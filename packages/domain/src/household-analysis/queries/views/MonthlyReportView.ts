import { z } from 'zod'
import { CommonMonthlyReportAttrsSchema } from '../../aggregates/MonthlyReport'
import { MoneySchema } from '../../../shared/value-objects/Money'
import { UnapprovedExpenseTransferSchema } from '../../../shared/value-objects/UnapprovedExpenseTransfer'

/**
 * 月次レポート共通属性の View 射影（プライバシー完全強制、A②）。
 *
 * 集約の共通属性から配偶者の経費(会社)合計を除外する。
 * `businessExpenseTotalHoney` / `businessExpenseTotalDarling` を落とし、
 * 閲覧者本人の経費(会社)合計だけを `businessExpenseTotalSelf` として持つ
 * （相手には合計すら見せない = 01-overview.md L155）。null 化ではなく
 * フィールドごと除外することで、非本人の値がレスポンスに一切現れない。
 * 個人合計（personalTotalHoney/Darling）は「相手には合計のみ可視」のため
 * 両方残す。
 */
export const MonthlyReportCommonViewSchema = CommonMonthlyReportAttrsSchema.omit({
  businessExpenseTotalHoney: true,
  businessExpenseTotalDarling: true,
}).extend({
  businessExpenseTotalSelf: MoneySchema,
})
export type MonthlyReportCommonView = z.infer<typeof MonthlyReportCommonViewSchema>

export const MonthlyReportViewSchema = z.object({
  status: z.enum(['csv_confirmed', 'finalized']),
  common: MonthlyReportCommonViewSchema,
  csvConfirmedAt: z.date(),
  finalizedAt: z.date().nullable(),
  unapprovedTransfers: z.array(UnapprovedExpenseTransferSchema).nullable(),
})
export type MonthlyReportView = z.infer<typeof MonthlyReportViewSchema>
