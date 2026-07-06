import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { ExpenseTypeIdSchema } from '../../shared/ids'

/** 経費種別移動イベント（08e §3。マスタ管理の経費種別削除リマップ要請への応答） */
export const ExpenseTypeRemappedSchema = DomainEventBaseSchema.extend({
  type: z.literal('ExpenseTypeRemapped'),
  oldExpenseTypeId: ExpenseTypeIdSchema,
  newExpenseTypeId: ExpenseTypeIdSchema,
  affectedTransactionCount: z.number().int().nonnegative(),
})
export type ExpenseTypeRemapped = z.infer<typeof ExpenseTypeRemappedSchema>
