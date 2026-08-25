/**
 * Amazon 注文確認メールのパース結果
 * @see docs/domain/08a-ul-取引取込.md §2「Amazon注文確認メール本文をパースする」
 *
 * kawasima: behavior Amazon注文確認メール本文をパースする = Amazon注文確認メール本文
 *   -> Amazon注文情報 OR 注文確認以外 OR パース失敗
 *
 * 失敗理由の語彙は SMBC 通知のパース失敗（`MailParseFailureReason`）と同じものを使う。
 * どちらも「Gmail から取った本文が読めなかった」ことの表現で、区別する必要が生じたことが
 * ない（増やすと集計側が 2 つの語彙を突き合わせることになる）。
 *
 * `not_order_confirmation` は、送信元ドメインだけで絞られた Amazon メール（発送のお知らせ・
 * お知らせメール・レビュー依頼など）を、注文確認メールとして読めなかった `parse_failure` から
 * 区別するために足した（#624）。`parse_failure` は「注文確認メールの目印はあるのに読めなかった」
 * ことだけを表し、それ以外の Amazon メールで `MailParseFailed` が発行されて集計を汚さないように
 * する。
 */
import { z } from 'zod'
import { GmailMessageIdSchema } from '../../shared/ids'
import { AmazonOrderInfoSchema } from './AmazonOrderInfo'
import { MailParseFailureReasonSchema } from './SmbcMailParseResult'

export const AmazonMailParseResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('order_confirmation'),
    order: AmazonOrderInfoSchema,
  }),
  z.object({
    kind: z.literal('not_order_confirmation'),
    gmailMessageId: GmailMessageIdSchema,
    detectedAt: z.date(),
  }),
  z.object({
    kind: z.literal('parse_failure'),
    gmailMessageId: GmailMessageIdSchema,
    reason: MailParseFailureReasonSchema,
    detectedAt: z.date(),
  }),
])
export type AmazonMailParseResult = z.infer<typeof AmazonMailParseResultSchema>
