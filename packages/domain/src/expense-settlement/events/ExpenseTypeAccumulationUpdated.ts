import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { ExpenseTypeAccumulationIdSchema } from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'
import { CapReachedStateSchema } from '../value-objects/ExpenseTypeAccumulation'

/** 経費種別累計更新イベント（08e §3） */
export const ExpenseTypeAccumulationUpdatedSchema = DomainEventBaseSchema.extend({
  type: z.literal('ExpenseTypeAccumulationUpdated'),
  accumulationId: ExpenseTypeAccumulationIdSchema,
  currentTotal: MoneySchema,
  capReached: CapReachedStateSchema.nullable(),
})
export type ExpenseTypeAccumulationUpdated = z.infer<typeof ExpenseTypeAccumulationUpdatedSchema>
