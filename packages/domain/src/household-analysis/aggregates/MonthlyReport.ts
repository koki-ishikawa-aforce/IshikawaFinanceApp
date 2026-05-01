/**
 * 月次レポート集約（家計分析コンテキスト）
 * @see docs/domain/08c-ul-家計分析.md §1
 * @see docs/domain/09-aggregates.md #8
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §5.2
 *
 * kawasima: data 月次レポート = CSV確定月次レポート OR 最終確定月次レポート
 * 不変条件: CSV確定 → 最終確定 の単方向遷移のみ許容（finalized → csv_confirmed への関数を提供しない）
 */
import { z } from 'zod'
import {
  MonthlyReportIdSchema,
  TransactionIdSchema,
  ExpenseReimbursementIdSchema,
  CategoryIdSchema,
  type ExpenseReimbursementId,
} from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'
import { YearMonthSchema } from '../../shared/value-objects/YearMonth'

/** 残高推移パート（残高・資産推移管理から借用する Read-only データ） */
export const BalanceTrendSchema = z.object({
  smbcBalanceTrend: z.array(z.object({ date: z.date(), balance: MoneySchema })),
  otherSavingsBalanceTrend: z.array(z.object({ date: z.date(), balance: MoneySchema })),
  nisaContributionTrend: z.array(z.object({ date: z.date(), accumulated: MoneySchema })),
  cardUnpaidTrend: z.array(z.object({ date: z.date(), unpaidTotal: MoneySchema })),
})
export type BalanceTrend = z.infer<typeof BalanceTrendSchema>

/** 月次レポート共通属性 */
export const CommonMonthlyReportAttrsSchema = z.object({
  monthlyReportId: MonthlyReportIdSchema,
  targetYearMonth: YearMonthSchema,
  householdCategoryTotals: z.array(
    z.object({
      categoryId: CategoryIdSchema,
      total: MoneySchema,
    }),
  ),
  personalTotalHoney: MoneySchema,
  personalTotalDarling: MoneySchema,
  businessExpenseTotalHoney: MoneySchema,
  businessExpenseTotalDarling: MoneySchema,
  nisaContributionAccumulated: MoneySchema,
  balanceTrend: BalanceTrendSchema,
  isIncompleteMonth: z.boolean().optional(),
})
export type CommonMonthlyReportAttrs = z.infer<typeof CommonMonthlyReportAttrsSchema>

/** 不認定分振替 */
export const UnapprovedExpenseTransferSchema = z.object({
  originalBusinessExpenseTransactionId: TransactionIdSchema,
  transferTarget: z.enum(['personal_honey', 'personal_darling']),
  transferAmount: MoneySchema,
  transferredAt: z.date(),
})
export type UnapprovedExpenseTransfer = z.infer<typeof UnapprovedExpenseTransferSchema>

/** 月次レポート（discriminated union） */
export const MonthlyReportSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('csv_confirmed'),
    common: CommonMonthlyReportAttrsSchema,
    csvConfirmedAt: z.date(),
    causingTransactionIds: z.array(TransactionIdSchema),
  }),
  z.object({
    kind: z.literal('finalized'),
    common: CommonMonthlyReportAttrsSchema,
    csvConfirmedAt: z.date(),
    finalizedAt: z.date(),
    expenseReimbursementId: ExpenseReimbursementIdSchema,
    expenseReimbursementMatchedAt: z.date(),
    unapprovedTransfers: z.array(UnapprovedExpenseTransferSchema),
  }),
])
export type MonthlyReport = z.infer<typeof MonthlyReportSchema>

export type CsvConfirmedReport = Extract<MonthlyReport, { kind: 'csv_confirmed' }>
export type FinalizedReport = Extract<MonthlyReport, { kind: 'finalized' }>

/** 状態遷移: CSV確定 → 最終確定（単方向） */
export function finalize(
  report: CsvConfirmedReport,
  expenseReimbursementId: ExpenseReimbursementId,
  matchedAt: Date,
  unapprovedTransfers: UnapprovedExpenseTransfer[],
  finalizedAt: Date,
): FinalizedReport {
  return MonthlyReportSchema.parse({
    kind: 'finalized',
    common: report.common,
    csvConfirmedAt: report.csvConfirmedAt,
    finalizedAt,
    expenseReimbursementId,
    expenseReimbursementMatchedAt: matchedAt,
    unapprovedTransfers,
  }) as FinalizedReport
}

// finalized → csv_confirmed への逆遷移関数は型として存在しない（不変条件で禁止）
