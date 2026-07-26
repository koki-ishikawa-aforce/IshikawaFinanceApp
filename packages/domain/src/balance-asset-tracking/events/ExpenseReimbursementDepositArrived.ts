import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import {
  BankDepositIdSchema,
  ExpenseReimbursementIdSchema,
  TransactionIdSchema,
  UserIdSchema,
} from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'

/**
 * 経費精算入金到着イベント（08d §3 → 経費精算の `behavior 経費精算入金を受信する` を起動する）
 *
 * kawasima: data 経費精算入金到着イベント = 取引ID AND 入金金額 AND 発生日時
 *
 * 08e が受信して発行する「経費精算入金受信イベント」(`ExpenseReimbursementDepositReceived`)
 * とは別物。こちらは 08d が供給する上流のトリガーで、混同すると突合の起点が消える。
 *
 * UL の 3 項目に加えて `userId` と `expenseReimbursementId` を載せる。経費精算入金集約は
 * ユーザーIDを必須に持ち（08e §1）、ID は判別時に採番して銀行入金集約が保持するため
 * （08d §1「経費精算入金判別 = 取引ID AND 経費精算入金ID AND 判別日時」）、受信側が
 * 独自に採番すると再実行のたびに別の突合対象が増える。
 */
export const ExpenseReimbursementDepositArrivedSchema = DomainEventBaseSchema.extend({
  type: z.literal('ExpenseReimbursementDepositArrived'),
  bankDepositId: BankDepositIdSchema,
  transactionId: TransactionIdSchema,
  userId: UserIdSchema,
  /** 判別時に採番済みの経費精算入金ID。受信側はこの ID で冪等に集約を作る */
  expenseReimbursementId: ExpenseReimbursementIdSchema,
  depositAmount: MoneySchema,
  depositedAt: z.date(),
})
export type ExpenseReimbursementDepositArrived = z.infer<
  typeof ExpenseReimbursementDepositArrivedSchema
>
