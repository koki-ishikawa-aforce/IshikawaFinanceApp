import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { ExpenseReimbursementIdSchema, MonthlyExpenseCycleIdSchema } from '../../shared/ids'
import { SettlementMatchDifferenceSchema } from '../value-objects/SettlementMatchDifference'

/** 経費突合イベント（08e §3） */
export const ExpenseDepositMatchedSchema = DomainEventBaseSchema.extend({
  type: z.literal('ExpenseDepositMatched'),
  expenseReimbursementId: ExpenseReimbursementIdSchema,
  monthlyExpenseCycleId: MonthlyExpenseCycleIdSchema,
  difference: SettlementMatchDifferenceSchema,
})
export type ExpenseDepositMatched = z.infer<typeof ExpenseDepositMatchedSchema>
