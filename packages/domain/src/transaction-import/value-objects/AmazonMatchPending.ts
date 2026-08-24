/**
 * Amazon 突合保留（08a §2「Amazon注文とSMBCカード利用通知を突合する」の一方の結末）
 *
 * kawasima: data Amazon突合保留 = Amazon注文ID AND 受信日時 AND タイムアウト期限
 *
 * 注文確認メールは読めたが、対になるカード利用通知をまだ決められない状態。「まだ届いていない」
 * 場合と「同額の候補が複数あってどれとも決められない」場合の両方がここに落ちる（どちらも
 * 誤った紐付けを作らないために保留する）。理由は `reason` で区別する — 前者は待てば解消しうるが、
 * 後者は待っても解消しないため、記録を読む人が「様子見でよいか」を判断できる必要がある。
 *
 * タイムアウト期限は「注文の受信日時 + 双方向 3 日」（`AMAZON_MATCH_TIMEOUT_DAYS`）。期限を
 * 過ぎた保留は `judgeAmazonMatchTimeout` が確定させ、注文情報は破棄する（配送キャンセルの
 * 可能性があるため取引候補にしない）。
 */
import { z } from 'zod'
import { AmazonOrderIdSchema } from '../../shared/ids'

/**
 * 保留の理由。
 *  - `card_usage_not_arrived`: 金額と期間の条件に当たるカード利用通知がまだ無い
 *  - `ambiguous`: 条件に当たる組み合わせが一意に決まらない（同日同金額の注文が複数ある等）
 */
export const AmazonMatchPendingReasonSchema = z.enum(['card_usage_not_arrived', 'ambiguous'])
export type AmazonMatchPendingReason = z.infer<typeof AmazonMatchPendingReasonSchema>

export const AmazonMatchPendingSchema = z.object({
  amazonOrderId: AmazonOrderIdSchema,
  receivedAt: z.date(),
  timeoutAt: z.date(),
  reason: AmazonMatchPendingReasonSchema,
})
export type AmazonMatchPending = z.infer<typeof AmazonMatchPendingSchema>
