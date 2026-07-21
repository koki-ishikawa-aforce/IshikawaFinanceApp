/**
 * 月次経費サイクル集約（経費精算コンテキスト）
 * @see docs/domain/08e-ul-経費精算.md §1
 * @see docs/domain/09-aggregates.md #11
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.2
 *
 * kawasima: data 月次経費サイクル = 集積中サイクル OR CSV確定サイクル OR 最終確定サイクル
 *
 * 不変条件:
 *  - 経費種別累計 ≤ 上限（超過分は按分子取引に分割）
 *  - 各累計の当月累計金額 = Σ 経費充当分（full は全額、partial は expenseAllocatedAmount）
 *  - 集積中 → CSV確定 → 最終確定 の単方向遷移のみ許容（後戻り関数を提供しない）
 *  - 最終確定サイクルには経費精算入金参照が必須（構造で表現）
 *  - ユーザーID + 対象年月で一意（Repository.findByUserAndMonth で保証、Phase 5 M-B）
 */
import { z } from 'zod'
import {
  MonthlyExpenseCycleIdSchema,
  UserIdSchema,
  TransactionIdSchema,
  ChildTransactionIdSchema,
  ExpenseReimbursementIdSchema,
  type ExpenseReimbursementId,
} from '../../shared/ids'
import { YearMonthSchema } from '../../shared/value-objects/YearMonth'
import {
  UnapprovedExpenseTransferSchema,
  type UnapprovedExpenseTransfer,
} from '../../shared/value-objects/UnapprovedExpenseTransfer'
import {
  ExpenseTypeAccumulationSchema,
  type ExpenseTypeAccumulation,
} from '../value-objects/ExpenseTypeAccumulation'
import { money, type Money } from '../../shared/value-objects/Money'
import {
  SettlementMatchDifferenceSchema,
  type SettlementMatchDifference,
} from '../value-objects/SettlementMatchDifference'

/** 按分子取引参照 */
export const ProratedChildRefSchema = z.object({
  childTransactionId: ChildTransactionIdSchema,
  parentTransactionId: TransactionIdSchema,
})
export type ProratedChildRef = z.infer<typeof ProratedChildRefSchema>

/** 共通属性 */
export const CommonMonthlyExpenseCycleAttrsSchema = z.object({
  monthlyExpenseCycleId: MonthlyExpenseCycleIdSchema,
  userId: UserIdSchema,
  targetYearMonth: YearMonthSchema,
  cycleStartedAt: z.date(),
  accumulations: z.array(ExpenseTypeAccumulationSchema),
  childTransactionRefs: z.array(ProratedChildRefSchema),
})
export type CommonMonthlyExpenseCycleAttrs = z.infer<typeof CommonMonthlyExpenseCycleAttrsSchema>

/** 累計の経費充当分合計（full は全額、partial は expenseAllocatedAmount） */
function sumExpenseAllocated(acc: ExpenseTypeAccumulation): number {
  return acc.transactionRefs.reduce((total, ref) => {
    if (ref.allocation.kind === 'full') return total + ref.amount
    return total + ref.allocation.expenseAllocatedAmount
  }, 0)
}

export const MonthlyExpenseCycleSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('accumulating'),
      common: CommonMonthlyExpenseCycleAttrsSchema,
    }),
    z.object({
      kind: z.literal('csv_confirmed'),
      common: CommonMonthlyExpenseCycleAttrsSchema,
      csvConfirmedAt: z.date(),
    }),
    z.object({
      kind: z.literal('finalized'),
      common: CommonMonthlyExpenseCycleAttrsSchema,
      csvConfirmedAt: z.date(),
      finalizedAt: z.date(),
      expenseReimbursementId: ExpenseReimbursementIdSchema,
      unapprovedTransfers: z.array(UnapprovedExpenseTransferSchema),
    }),
  ])
  .superRefine((cycle, ctx) => {
    cycle.common.accumulations.forEach((acc, i) => {
      if (acc.kind === 'capped' && acc.currentTotal > acc.monthlyCap) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `経費種別累計（${acc.currentTotal}）が月次上限（${acc.monthlyCap}）を超過している（超過分は按分子取引に分割される）`,
          path: ['common', 'accumulations', i, 'currentTotal'],
        })
      }
      const sum = sumExpenseAllocated(acc)
      if (sum !== acc.currentTotal) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `当月累計金額（${acc.currentTotal}）と経費充当分合計（${sum}）が一致しない`,
          path: ['common', 'accumulations', i, 'currentTotal'],
        })
      }
    })
  })
export type MonthlyExpenseCycle = z.infer<typeof MonthlyExpenseCycleSchema>

export type AccumulatingCycle = Extract<MonthlyExpenseCycle, { kind: 'accumulating' }>
export type CsvConfirmedCycle = Extract<MonthlyExpenseCycle, { kind: 'csv_confirmed' }>
export type FinalizedCycle = Extract<MonthlyExpenseCycle, { kind: 'finalized' }>

/** 当月経費合計（暫定経費合計 = Σ 経費種別累計の当月累計金額、08e §2） */
export function cycleExpenseTotal(cycle: MonthlyExpenseCycle): Money {
  return money(cycle.common.accumulations.reduce((total, acc) => total + acc.currentTotal, 0))
}

/**
 * 経費精算入金との突合差額を算出する（08e §2「経費精算入金と当月経費を突合する」）
 * - 入金額 < 当月経費合計 → 不認定分（unapproved_shortfall）
 * - 入金額 > 当月経費合計 → 認定済み超過（approved_excess、稀ケース）
 * - 一致 → 完全一致（exact_match）
 */
export function calculateSettlementMatchDifference(
  cycle: MonthlyExpenseCycle,
  depositAmount: Money,
): SettlementMatchDifference {
  const expenseTotal = cycleExpenseTotal(cycle)
  if (depositAmount < expenseTotal) {
    return SettlementMatchDifferenceSchema.parse({
      kind: 'unapproved_shortfall',
      difference: expenseTotal - depositAmount,
    })
  }
  if (depositAmount > expenseTotal) {
    return SettlementMatchDifferenceSchema.parse({
      kind: 'approved_excess',
      difference: depositAmount - expenseTotal,
    })
  }
  return SettlementMatchDifferenceSchema.parse({ kind: 'exact_match' })
}

/** 状態遷移: 集積中 → CSV確定 */
export function confirmCycleCsv(cycle: AccumulatingCycle, at: Date): CsvConfirmedCycle {
  return MonthlyExpenseCycleSchema.parse({
    kind: 'csv_confirmed',
    common: cycle.common,
    csvConfirmedAt: at,
  }) as CsvConfirmedCycle
}

/** 状態遷移: CSV確定 → 最終確定（経費精算入金参照が必須） */
export function finalizeCycle(
  cycle: CsvConfirmedCycle,
  expenseReimbursementId: ExpenseReimbursementId,
  unapprovedTransfers: UnapprovedExpenseTransfer[],
  at: Date,
): FinalizedCycle {
  return MonthlyExpenseCycleSchema.parse({
    kind: 'finalized',
    common: cycle.common,
    csvConfirmedAt: cycle.csvConfirmedAt,
    finalizedAt: at,
    expenseReimbursementId,
    unapprovedTransfers,
  }) as FinalizedCycle
}
