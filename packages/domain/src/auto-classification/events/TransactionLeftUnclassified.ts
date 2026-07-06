import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { TransactionIdSchema, UserIdSchema } from '../../shared/ids'
import { UnclassifiedReasonSchema } from '../../shared/value-objects/UnclassifiedReason'

/** 取引が未分類で取り込まれたイベント（08b §3） */
export const TransactionLeftUnclassifiedSchema = DomainEventBaseSchema.extend({
  type: z.literal('TransactionLeftUnclassified'),
  transactionId: TransactionIdSchema,
  userId: UserIdSchema,
  reason: UnclassifiedReasonSchema,
})
export type TransactionLeftUnclassified = z.infer<typeof TransactionLeftUnclassifiedSchema>
