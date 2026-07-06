/**
 * 重複判定結果
 * @see docs/domain/08a-ul-取引取込.md §1
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.3
 *
 * kawasima: data 重複判定結果 = 重複あり OR 重複なし
 * 検出根拠 = Gmail_message_ID 完全一致 OR 三項一致（発生日 + 金額 + 加盟店名〔NFKC 正規化済み〕、
 * OQ-23 / OQ-7）。
 */
import { z } from 'zod'
import { GmailMessageIdSchema, TransactionCandidateIdSchema } from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'

export const DuplicationBasisSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('gmail_message_id'), gmailMessageId: GmailMessageIdSchema }),
  z.object({
    kind: z.literal('triple_match'),
    occurredOn: z.date(),
    amount: MoneySchema,
    merchantName: z.string().min(1),
  }),
])
export type DuplicationBasis = z.infer<typeof DuplicationBasisSchema>

export const DuplicationJudgmentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('duplicate'),
    existingCandidateId: TransactionCandidateIdSchema,
    basis: DuplicationBasisSchema,
    detectedAt: z.date(),
  }),
  z.object({ kind: z.literal('not_duplicate'), detectedAt: z.date() }),
])
export type DuplicationJudgment = z.infer<typeof DuplicationJudgmentSchema>
