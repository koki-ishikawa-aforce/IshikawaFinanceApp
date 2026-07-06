import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { ExpenseReimbursementIdSchema } from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'

/** 経費精算入金受信イベント（08e §3） */
export const ExpenseReimbursementDepositReceivedSchema = DomainEventBaseSchema.extend({
  type: z.literal('ExpenseReimbursementDepositReceived'),
  expenseReimbursementId: ExpenseReimbursementIdSchema,
  depositAmount: MoneySchema,
})
export type ExpenseReimbursementDepositReceived = z.infer<
  typeof ExpenseReimbursementDepositReceivedSchema
>
