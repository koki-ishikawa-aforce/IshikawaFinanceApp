import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { TransactionIdSchema, UserIdSchema } from '../../shared/ids'
import { ExpenseClassSchema } from '../../shared/value-objects/ExpenseClass'

/** 経費フラグ切替イベント（08e §3。切替先は個人(本人) 系の値に限る — behavior 事前条件） */
export const ExpenseFlagSwitchedSchema = DomainEventBaseSchema.extend({
  type: z.literal('ExpenseFlagSwitched'),
  transactionId: TransactionIdSchema,
  oldExpenseClass: ExpenseClassSchema,
  newExpenseClass: ExpenseClassSchema,
  operatorUserId: UserIdSchema,
})
export type ExpenseFlagSwitched = z.infer<typeof ExpenseFlagSwitchedSchema>
