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
 *  - 確定済み候補は再確定できない（confirmed からの遷移関数を提供しない）
 */
import { z } from 'zod'
import { TransactionCandidateIdSchema, TransactionIdSchema, UserIdSchema } from '../../shared/ids'
import type { AmazonOrderId, GmailMessageId, TransactionId } from '../../shared/ids'
import { InvariantViolationError } from '../../shared/errors/DomainError'
import { MoneySchema } from '../../shared/value-objects/Money'
import { CandidateImportSourceSchema } from '../value-objects/CandidateImportSource'
import { AmazonProductInfoSchema, type AmazonProductInfo } from '../value-objects/AmazonOrderInfo'

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
    z.object({
      kind: z.literal('confirmed'),
      common: CommonTransactionCandidateAttrsSchema,
      confirmedAt: z.date(),
      createdTransactionId: TransactionIdSchema,
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
export type ConfirmedTransactionCandidate = Extract<TransactionCandidate, { kind: 'confirmed' }>

/**
 * メール由来の取引候補の出所（Gmail message ID）。
 *
 * 取込ソースは 5 種の判別共用体で、メール由来以外は Gmail message ID を持たない。突合イベントの
 * SMBC 側の出所として使うため、持たない候補を渡されたら不変条件違反として弾く（呼出し側が
 * 絞り込みを間違えると、突合の記録が別経路の取込を指すことになる）。
 */
export function emailGmailMessageIdOf(candidate: NormalTransactionCandidate): GmailMessageId {
  const source = candidate.common.importSource
  if (source.kind !== 'email') {
    throw new InvariantViolationError('メール由来でない取引候補は Gmail message ID を持たない')
  }
  return source.gmailMessageId
}

/**
 * 状態遷移: 通常取引候補 → Amazon突合取引候補（08a §2「Amazon注文とSMBCカード利用通知を突合する」）
 *
 * カード利用通知から作った候補に、突き合わせた注文の商品名を紐付ける。候補 ID は変えない
 * （同じ支払いの記録が 2 件になると、金額が二重に計上される）。取込ソースは `amazon_match` へ
 * 変わるが、元の Gmail message ID は `smbcGmailMessageId` として持ち続けるため、同じメールの
 * 重複除外は突合の後も効く。
 *
 * 突合できるのはメール由来の候補だけ。CSV / PDF 由来の候補には突き合わせる Gmail message ID が
 * 無く、`amazon_match` の取込ソースを組み立てられない（呼出し側の絞り込み漏れを型では防げない
 * ため、ここで不変条件として弾く）。
 */
export function matchAmazonOrder(
  candidate: NormalTransactionCandidate,
  order: { amazonOrderId: AmazonOrderId; products: readonly AmazonProductInfo[] },
  at: Date,
): AmazonMatchedTransactionCandidate {
  const source = candidate.common.importSource
  if (source.kind !== 'email') {
    throw new InvariantViolationError(
      'Amazon 突合できるのはメール由来の取引候補だけ（SMBC_Gmail_message_ID が必要）',
    )
  }
  return TransactionCandidateSchema.parse({
    kind: 'amazon_matched',
    common: {
      ...candidate.common,
      importSource: {
        kind: 'amazon_match',
        smbcGmailMessageId: source.gmailMessageId,
        amazonOrderId: order.amazonOrderId,
      },
    },
    products: order.products,
    matchedAt: at,
  }) as AmazonMatchedTransactionCandidate
}

/**
 * 状態遷移: 通常取引候補 → 突合タイムアウト未分類候補（08a §1 / 08b §2 の事後条件）
 *
 * 双方向 3 日のタイムアウトに達した候補を「Amazon 注文不明」として未分類で確定させる（V-2）。
 * 取込ソースは元のまま（メール由来）残す — 突合が成立していない以上、Amazon 突合由来を
 * 名乗らせると、どの注文と結び付いたのかが不明なまま `amazonOrderId` を持つことになる。
 */
export function confirmMatchTimeout(
  candidate: NormalTransactionCandidate,
  timeoutDirection: TimeoutDirection,
  at: Date,
): MatchTimeoutTransactionCandidate {
  return TransactionCandidateSchema.parse({
    kind: 'match_timeout',
    common: candidate.common,
    timedOutAt: at,
    timeoutDirection,
  }) as MatchTimeoutTransactionCandidate
}

/** 状態遷移: 未確定候補 → 確定済み（取引生成済み・消費済み） */
export function confirmCandidate(
  candidate:
    | NormalTransactionCandidate
    | AmazonMatchedTransactionCandidate
    | MatchTimeoutTransactionCandidate,
  createdTransactionId: TransactionId,
  at: Date,
): ConfirmedTransactionCandidate {
  return TransactionCandidateSchema.parse({
    kind: 'confirmed',
    common: candidate.common,
    confirmedAt: at,
    createdTransactionId,
  }) as ConfirmedTransactionCandidate
}
