/**
 * 取引候補集約（取引取込コンテキスト）
 * @see docs/domain/08a-ul-取引取込.md §1
 * @see docs/domain/09-aggregates.md #1
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.3
 *
 * kawasima: data 取引候補 = 通常取引候補 OR Amazon突合取引候補 OR 突合タイムアウト未分類候補
 *
 * 不変条件:
 *  - パース失敗時は取引候補が生成されない（パース失敗は SmbcMailParseResult 側で表現）
 *  - Gmail_message_ID 重複時は新規取引候補を生成しない（重複除外の閉包、
 *    Repository.findByGmailMessageId で保証、Phase 5 M-B）
 *  - Amazon突合取引候補の取込ソースは amazon_match でなければならない
 */
import { z } from 'zod'
import { TransactionCandidateIdSchema, UserIdSchema } from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'
import { CandidateImportSourceSchema } from '../value-objects/CandidateImportSource'
import { AmazonProductInfoSchema } from '../value-objects/AmazonOrderInfo'

/** タイムアウト方向 */
export const TimeoutDirectionSchema = z.enum([
  'smbc_first_awaiting_amazon',
  'amazon_first_awaiting_smbc',
])
export type TimeoutDirection = z.infer<typeof TimeoutDirectionSchema>

/** 共通属性 */
export const CommonTransactionCandidateAttrsSchema = z.object({
  transactionCandidateId: TransactionCandidateIdSchema,
  userId: UserIdSchema,
  importSource: CandidateImportSourceSchema,
  merchantName: z.string().min(1),
  amount: MoneySchema,
  occurredAt: z.date(),
})
export type CommonTransactionCandidateAttrs = z.infer<typeof CommonTransactionCandidateAttrsSchema>

export const TransactionCandidateSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('normal'),
      common: CommonTransactionCandidateAttrsSchema,
    }),
    z.object({
      kind: z.literal('amazon_matched'),
      common: CommonTransactionCandidateAttrsSchema,
      products: z.array(AmazonProductInfoSchema).min(1),
      matchedAt: z.date(),
    }),
    z.object({
      kind: z.literal('match_timeout'),
      common: CommonTransactionCandidateAttrsSchema,
      timedOutAt: z.date(),
      timeoutDirection: TimeoutDirectionSchema,
    }),
  ])
  .superRefine((candidate, ctx) => {
    if (
      candidate.kind === 'amazon_matched' &&
      candidate.common.importSource.kind !== 'amazon_match'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Amazon突合取引候補の取込ソースは amazon_match でなければならない',
        path: ['common', 'importSource'],
      })
    }
  })
export type TransactionCandidate = z.infer<typeof TransactionCandidateSchema>

export type NormalTransactionCandidate = Extract<TransactionCandidate, { kind: 'normal' }>
export type AmazonMatchedTransactionCandidate = Extract<
  TransactionCandidate,
  { kind: 'amazon_matched' }
>
export type MatchTimeoutTransactionCandidate = Extract<
  TransactionCandidate,
  { kind: 'match_timeout' }
>
