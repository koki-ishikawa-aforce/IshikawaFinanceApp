import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { TransactionIdSchema, UserIdSchema } from '../../shared/ids'
import { ClassificationBasisSchema } from '../../shared/value-objects/ClassificationBasis'

/** 取引が自動分類で取り込まれたイベント（08b §3） */
export const TransactionAutoClassifiedSchema = DomainEventBaseSchema.extend({
  type: z.literal('TransactionAutoClassified'),
  transactionId: TransactionIdSchema,
  userId: UserIdSchema,
  basis: ClassificationBasisSchema,
})
export type TransactionAutoClassified = z.infer<typeof TransactionAutoClassifiedSchema>
