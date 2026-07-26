import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import {
  AccountIdSchema,
  BankDepositIdSchema,
  ExpenseReimbursementIdSchema,
  TransactionIdSchema,
  UserIdSchema,
} from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'
import { DeterminedDepositPurposeSchema } from '../value-objects/DepositPurpose'
import { DeterminationSourceSchema } from '../aggregates/BankDeposit'

/**
 * 入金用途判別イベント（08d §3）
 *
 * 用途が確定した入金のみを載せる。用途不明（手動確認待ち）は確定していないため発行しない
 * — 発行してしまうと購読側（経費精算の突合起動・残高加算）が未確定の入金で動く。
 *
 * kawasima: data 入金用途判別イベント = 取引ID AND 入金用途判別結果 AND 発生日時
 */
export const BankDepositPurposeDeterminedSchema = DomainEventBaseSchema.extend({
  type: z.literal('BankDepositPurposeDetermined'),
  bankDepositId: BankDepositIdSchema,
  accountId: AccountIdSchema,
  transactionId: TransactionIdSchema,
  userId: UserIdSchema,
  amount: MoneySchema,
  purpose: DeterminedDepositPurposeSchema,
  /** 経費精算入金判別のときのみ。突合の起動側が同じ ID を使えるようにする（08d §1） */
  expenseReimbursementId: ExpenseReimbursementIdSchema.optional(),
  determinationSource: DeterminationSourceSchema,
})
export type BankDepositPurposeDetermined = z.infer<typeof BankDepositPurposeDeterminedSchema>
