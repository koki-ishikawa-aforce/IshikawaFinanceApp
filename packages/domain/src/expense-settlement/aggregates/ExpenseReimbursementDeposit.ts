/**
 * 経費精算入金集約（経費精算コンテキスト）
 * @see docs/domain/08e-ul-経費精算.md §1
 * @see docs/domain/09-aggregates.md #13
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.2
 *
 * kawasima: data 経費精算入金 = 突合状態（突合待ち OR 突合済み OR 不認定分確定済み）
 *
 * 不変条件:
 *  - ユーザーID + 入金日時で実質一意（同月の経費精算入金は 1 件のみ突合対象、
 *    Repository で保証、Phase 5 M-B）
 *  - 突合待ち → 突合済み → 不認定分確定済み の単方向遷移のみ許容（後戻り関数を提供しない）
 */
import { z } from 'zod'
import {
  ExpenseReimbursementIdSchema,
  UserIdSchema,
  MonthlyExpenseCycleIdSchema,
  type MonthlyExpenseCycleId,
} from '../../shared/ids'
import { MoneySchema, type Money } from '../../shared/value-objects/Money'

/** 共通属性 */
export const CommonExpenseReimbursementDepositAttrsSchema = z.object({
  expenseReimbursementId: ExpenseReimbursementIdSchema,
  userId: UserIdSchema,
  // 入金金額は正（0 円・負の入金は経費精算入金として無意味、08e §1）。
  // 正値制約は集約 VO 側で中央強制し、API 層で再実装しない。
  depositAmount: MoneySchema.refine(v => v > 0, '入金金額は正である必要があります'),
  depositedAt: z.date(),
})
export type CommonExpenseReimbursementDepositAttrs = z.infer<
  typeof CommonExpenseReimbursementDepositAttrsSchema
>

export const ExpenseReimbursementDepositSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('awaiting_match'),
    common: CommonExpenseReimbursementDepositAttrsSchema,
    receivedAt: z.date(),
  }),
  z.object({
    kind: z.literal('matched'),
    common: CommonExpenseReimbursementDepositAttrsSchema,
    matchedAt: z.date(),
    matchedCycleId: MonthlyExpenseCycleIdSchema,
  }),
  z.object({
    kind: z.literal('unrecognized_confirmed'),
    common: CommonExpenseReimbursementDepositAttrsSchema,
    matchedAt: z.date(),
    matchedCycleId: MonthlyExpenseCycleIdSchema,
    unapprovedTotal: MoneySchema,
    transferConfirmedAt: z.date(),
  }),
])
export type ExpenseReimbursementDeposit = z.infer<typeof ExpenseReimbursementDepositSchema>

export type AwaitingMatchDeposit = Extract<ExpenseReimbursementDeposit, { kind: 'awaiting_match' }>
export type MatchedDeposit = Extract<ExpenseReimbursementDeposit, { kind: 'matched' }>
export type UnrecognizedConfirmedDeposit = Extract<
  ExpenseReimbursementDeposit,
  { kind: 'unrecognized_confirmed' }
>

/** 状態遷移: 突合待ち → 突合済み */
export function matchDeposit(
  deposit: AwaitingMatchDeposit,
  matchedCycleId: MonthlyExpenseCycleId,
  at: Date,
): MatchedDeposit {
  return ExpenseReimbursementDepositSchema.parse({
    kind: 'matched',
    common: deposit.common,
    matchedAt: at,
    matchedCycleId,
  }) as MatchedDeposit
}

/** 状態遷移: 突合済み → 不認定分確定済み */
export function confirmUnrecognizedDeposit(
  deposit: MatchedDeposit,
  unapprovedTotal: Money,
  at: Date,
): UnrecognizedConfirmedDeposit {
  return ExpenseReimbursementDepositSchema.parse({
    kind: 'unrecognized_confirmed',
    common: deposit.common,
    matchedAt: deposit.matchedAt,
    matchedCycleId: deposit.matchedCycleId,
    unapprovedTotal,
    transferConfirmedAt: at,
  }) as UnrecognizedConfirmedDeposit
}
