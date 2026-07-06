import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { TransactionIdSchema, ExpenseTypeIdSchema, UserIdSchema } from '../../shared/ids'

/** 取引が経費としてマークされたイベント（08e §3） */
export const TransactionMarkedAsExpenseSchema = DomainEventBaseSchema.extend({
  type: z.literal('TransactionMarkedAsExpense'),
  transactionId: TransactionIdSchema,
  expenseTypeId: ExpenseTypeIdSchema,
  userId: UserIdSchema,
})
export type TransactionMarkedAsExpense = z.infer<typeof TransactionMarkedAsExpenseSchema>
