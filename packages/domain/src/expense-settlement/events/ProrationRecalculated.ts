import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { MonthlyExpenseCycleIdSchema, TransactionIdSchema } from '../../shared/ids'

/** 按分再計算イベント（08e §3。同月内の修正・削除・フラグ切替起因） */
export const ProrationRecalculatedSchema = DomainEventBaseSchema.extend({
  type: z.literal('ProrationRecalculated'),
  monthlyExpenseCycleId: MonthlyExpenseCycleIdSchema,
  causingTransactionId: TransactionIdSchema,
  recalculatedChildCount: z.number().int().nonnegative(),
})
export type ProrationRecalculated = z.infer<typeof ProrationRecalculatedSchema>
