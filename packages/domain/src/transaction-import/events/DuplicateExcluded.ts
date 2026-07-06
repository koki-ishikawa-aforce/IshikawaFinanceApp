import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import {
  GmailMessageIdSchema,
  TransactionCandidateIdSchema,
  ImportJobIdSchema,
} from '../../shared/ids'
import { DuplicationBasisSchema } from '../value-objects/DuplicationJudgment'

/**
 * 重複除外イベント（08a §3）
 * 08a の「重複除外」（メール由来）と「CSV重複除外」は subject の違いのみのため 1 イベントに統合。
 * CSV 取込起因の場合は importJobId を設定する。
 */
export const DuplicateExclusionSubjectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('gmail_message'), gmailMessageId: GmailMessageIdSchema }),
  z.object({ kind: z.literal('candidate'), transactionCandidateId: TransactionCandidateIdSchema }),
])
export type DuplicateExclusionSubject = z.infer<typeof DuplicateExclusionSubjectSchema>

export const DuplicateExcludedSchema = DomainEventBaseSchema.extend({
  type: z.literal('DuplicateExcluded'),
  subject: DuplicateExclusionSubjectSchema,
  basis: DuplicationBasisSchema,
  importJobId: ImportJobIdSchema.optional(),
})
export type DuplicateExcluded = z.infer<typeof DuplicateExcludedSchema>
