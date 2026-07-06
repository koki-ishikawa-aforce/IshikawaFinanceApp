import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { TransactionIdSchema, UserIdSchema } from '../../shared/ids'
import { ExpenseClassSchema } from '../../shared/value-objects/ExpenseClass'
import { PersonalExpenseClassSchema } from '../../shared/value-objects/PersonalExpenseClass'

/**
 * 経費フラグ切替イベント（08e §3）
 * 切替先は個人(本人) 系の値に限る（型で強制。切替先 = 操作者本人の個人区分であることは
 * behavior 事前条件として残る）。
 */
export const ExpenseFlagSwitchedSchema = DomainEventBaseSchema.extend({
  type: z.literal('ExpenseFlagSwitched'),
  transactionId: TransactionIdSchema,
  oldExpenseClass: ExpenseClassSchema,
  newExpenseClass: PersonalExpenseClassSchema,
  operatorUserId: UserIdSchema,
})
export type ExpenseFlagSwitched = z.infer<typeof ExpenseFlagSwitchedSchema>
