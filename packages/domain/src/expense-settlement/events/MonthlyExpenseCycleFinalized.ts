import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { MonthlyExpenseCycleIdSchema } from '../../shared/ids'

/** 月次経費精算サイクル確定イベント（08e §3） */
export const MonthlyExpenseCycleFinalizedSchema = DomainEventBaseSchema.extend({
  type: z.literal('MonthlyExpenseCycleFinalized'),
  monthlyExpenseCycleId: MonthlyExpenseCycleIdSchema,
  finalizedAt: z.date(),
})
export type MonthlyExpenseCycleFinalized = z.infer<typeof MonthlyExpenseCycleFinalizedSchema>
