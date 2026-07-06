import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { TransactionCandidateIdSchema, UserIdSchema } from '../../shared/ids'
import { CandidateImportSourceSchema } from '../value-objects/CandidateImportSource'

/** 取引候補抽出済みイベント（08a §3） */
export const TransactionCandidateExtractedSchema = DomainEventBaseSchema.extend({
  type: z.literal('TransactionCandidateExtracted'),
  transactionCandidateId: TransactionCandidateIdSchema,
  userId: UserIdSchema,
  importSource: CandidateImportSourceSchema,
})
export type TransactionCandidateExtracted = z.infer<typeof TransactionCandidateExtractedSchema>
