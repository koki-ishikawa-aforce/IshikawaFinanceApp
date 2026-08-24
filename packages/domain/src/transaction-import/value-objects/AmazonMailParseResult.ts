/**
 * Amazon 注文確認メールのパース結果
 * @see docs/domain/08a-ul-取引取込.md §2「Amazon注文確認メール本文をパースする」
 *
 * kawasima: behavior Amazon注文確認メール本文をパースする = Amazon注文確認メール本文
 *   -> Amazon注文情報 OR パース失敗
 *
 * 失敗理由の語彙は SMBC 通知のパース失敗（`MailParseFailureReason`）と同じものを使う。
 * どちらも「Gmail から取った本文が読めなかった」ことの表現で、区別する必要が生じたことが
 * ない（増やすと集計側が 2 つの語彙を突き合わせることになる）。
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
    kind: z.literal('parse_failure'),
    gmailMessageId: GmailMessageIdSchema,
    reason: MailParseFailureReasonSchema,
    detectedAt: z.date(),
  }),
])
export type AmazonMailParseResult = z.infer<typeof AmazonMailParseResultSchema>
