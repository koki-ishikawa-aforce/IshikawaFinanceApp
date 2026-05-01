import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { TransactionIdSchema, UserIdSchema } from '../../shared/ids'
import { DeletionReasonSchema } from '../aggregates/Transaction'

export const TransactionDeletedSchema = DomainEventBaseSchema.extend({
  type: z.literal('TransactionDeleted'),
  transactionId: TransactionIdSchema,
  deletedByUserId: UserIdSchema,
  deletionReason: DeletionReasonSchema,
})
export type TransactionDeleted = z.infer<typeof TransactionDeletedSchema>
