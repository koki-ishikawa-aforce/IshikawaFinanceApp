/**
 * 経費精算管理ビュー
 * @see docs/domain/08e-ul-経費精算.md §1
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.2
 *
 * kawasima: data 経費精算管理ビュー = ユーザーID AND 当月経費種別累計リスト
 *   AND 当月按分子取引リスト AND 直近月の最終確定サイクル?
 *
 * プライバシー: 本人のみ可視（論点11、3 段階プライバシー）。
 */
import { z } from 'zod'
import { UserIdSchema, MonthlyExpenseCycleIdSchema } from '../../../shared/ids'
import { MoneySchema } from '../../../shared/value-objects/Money'
import { YearMonthSchema } from '../../../shared/value-objects/YearMonth'
import { ExpenseTypeAccumulationSchema } from '../../value-objects/ExpenseTypeAccumulation'
import { ProratedChildTransactionSchema } from '../../aggregates/ProratedChildTransaction'

export const LatestFinalizedCycleSummarySchema = z.object({
  monthlyExpenseCycleId: MonthlyExpenseCycleIdSchema,
  targetYearMonth: YearMonthSchema,
  finalizedAt: z.date(),
  unapprovedTotal: MoneySchema,
})
export type LatestFinalizedCycleSummary = z.infer<typeof LatestFinalizedCycleSummarySchema>

export const ExpenseSettlementManagementViewSchema = z.object({
  userId: UserIdSchema,
  currentAccumulations: z.array(ExpenseTypeAccumulationSchema),
  currentChildTransactions: z.array(ProratedChildTransactionSchema),
  latestFinalizedCycle: LatestFinalizedCycleSummarySchema.nullable(),
})
export type ExpenseSettlementManagementView = z.infer<typeof ExpenseSettlementManagementViewSchema>
