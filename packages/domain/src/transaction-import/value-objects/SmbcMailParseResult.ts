/**
 * SMBC 通知パース結果
 * @see docs/domain/08a-ul-取引取込.md §1
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.3
 *
 * kawasima: data SMBC通知パース結果 = カード利用 OR 銀行入金 OR 銀行出金 OR
 *   カード引落確定 OR カード返金 OR パース失敗
 *
 * 事前条件: 加盟店名は NFKC 正規化・空白圧縮・長音統一済み（OQ-23）。
 */
import { z } from 'zod'
import { GmailMessageIdSchema, UserIdSchema } from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'
import { YearMonthSchema } from '../../shared/value-objects/YearMonth'

export const MailParseFailureReasonSchema = z.enum([
  'structure_mismatch',
  'missing_required_field',
  'garbled_text',
  'other',
])
export type MailParseFailureReason = z.infer<typeof MailParseFailureReasonSchema>

export const SmbcMailParseResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('card_usage'),
    gmailMessageId: GmailMessageIdSchema,
    userId: UserIdSchema,
    merchantName: z.string().min(1),
    amount: MoneySchema,
    occurredAt: z.date(),
    cardKind: z.literal('mitsui_sumitomo'),
  }),
  z.object({
    kind: z.literal('bank_deposit'),
    gmailMessageId: GmailMessageIdSchema,
    userId: UserIdSchema,
    payerName: z.string().min(1),
    amount: MoneySchema,
    occurredAt: z.date(),
    description: z.string().optional(),
  }),
  z.object({
    kind: z.literal('bank_withdrawal'),
    gmailMessageId: GmailMessageIdSchema,
    userId: UserIdSchema,
    payeeName: z.string().min(1),
    amount: MoneySchema,
    occurredAt: z.date(),
    description: z.string().optional(),
  }),
  z.object({
    kind: z.literal('card_settlement_confirmed'),
    gmailMessageId: GmailMessageIdSchema,
    userId: UserIdSchema,
    totalAmount: MoneySchema,
    settlementDate: z.date(),
    targetMonth: YearMonthSchema,
  }),
  z.object({
    kind: z.literal('card_refund'),
    gmailMessageId: GmailMessageIdSchema,
    userId: UserIdSchema,
    merchantName: z.string().min(1),
    refundAmount: MoneySchema,
    refundedAt: z.date(),
  }),
  z.object({
    kind: z.literal('parse_failure'),
    gmailMessageId: GmailMessageIdSchema,
    reason: MailParseFailureReasonSchema,
    detectedAt: z.date(),
  }),
])
export type SmbcMailParseResult = z.infer<typeof SmbcMailParseResultSchema>
