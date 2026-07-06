/**
 * 経費種別累計（上限あり OR 無制限）
 * @see docs/domain/08e-ul-経費精算.md §1
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.2
 *
 * kawasima: data 経費種別累計 = 上限あり経費種別累計 OR 無制限経費種別累計
 *
 * 不変条件:
 *  - 論点15: 無制限は上限金額・上限到達状態を構造的に持たない（マジックナンバー不使用、
 *    `.strict()` で余剰キーを拒否）
 *  - 上限あり: 当月累計 ≤ 上限（MonthlyExpenseCycle 側の superRefine で検査）
 *  - 部分経費充当: 経費充当分 + 個人充当分 = 取引金額（取引の分割、08e §1）、
 *    経費充当分 ≥ 0、個人充当分 > 0（superRefine で検査）
 */
import { z } from 'zod'
import {
  ExpenseTypeAccumulationIdSchema,
  ExpenseTypeIdSchema,
  UserIdSchema,
  TransactionIdSchema,
  ChildTransactionIdSchema,
} from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'

/** 充当区分（全額経費充当 OR 部分経費充当） */
export const ExpenseAllocationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('full') }),
  z.object({
    kind: z.literal('partial'),
    expenseAllocatedAmount: MoneySchema,
    personalAllocatedAmount: MoneySchema,
    childTransactionId: ChildTransactionIdSchema,
  }),
])
export type ExpenseAllocation = z.infer<typeof ExpenseAllocationSchema>

/** 経費取引参照（累計を構成する取引と充当内訳） */
export const ExpenseTransactionRefSchema = z
  .object({
    transactionId: TransactionIdSchema,
    occurredAt: z.date(),
    amount: MoneySchema,
    allocation: ExpenseAllocationSchema,
  })
  .superRefine((ref, ctx) => {
    if (ref.allocation.kind !== 'partial') return
    const { expenseAllocatedAmount, personalAllocatedAmount } = ref.allocation
    if (expenseAllocatedAmount < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `経費充当分（${expenseAllocatedAmount}）が負値`,
        path: ['allocation', 'expenseAllocatedAmount'],
      })
    }
    if (personalAllocatedAmount <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `個人充当分（${personalAllocatedAmount}）が正値でない（部分経費充当は超過分の個人按分を伴う）`,
        path: ['allocation', 'personalAllocatedAmount'],
      })
    }
    if (expenseAllocatedAmount + personalAllocatedAmount !== ref.amount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `経費充当分（${expenseAllocatedAmount}）+ 個人充当分（${personalAllocatedAmount}）が取引金額（${ref.amount}）と一致しない`,
        path: ['allocation'],
      })
    }
  })
export type ExpenseTransactionRef = z.infer<typeof ExpenseTransactionRefSchema>

/** 上限到達状態 */
export const CapReachedStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('not_reached') }),
  z.object({
    kind: z.literal('reached'),
    reachedAt: z.date(),
    reachingTransactionId: TransactionIdSchema,
  }),
])
export type CapReachedState = z.infer<typeof CapReachedStateSchema>

export const ExpenseTypeAccumulationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('capped'),
    accumulationId: ExpenseTypeAccumulationIdSchema,
    expenseTypeId: ExpenseTypeIdSchema,
    userId: UserIdSchema,
    monthlyCap: MoneySchema,
    currentTotal: MoneySchema,
    capReached: CapReachedStateSchema,
    transactionRefs: z.array(ExpenseTransactionRefSchema),
  }),
  z
    .object({
      kind: z.literal('unlimited'),
      accumulationId: ExpenseTypeAccumulationIdSchema,
      expenseTypeId: ExpenseTypeIdSchema,
      userId: UserIdSchema,
      currentTotal: MoneySchema,
      transactionRefs: z.array(ExpenseTransactionRefSchema),
    })
    .strict(),
])
export type ExpenseTypeAccumulation = z.infer<typeof ExpenseTypeAccumulationSchema>

export type CappedExpenseTypeAccumulation = Extract<ExpenseTypeAccumulation, { kind: 'capped' }>
export type UnlimitedExpenseTypeAccumulation = Extract<
  ExpenseTypeAccumulation,
  { kind: 'unlimited' }
>
