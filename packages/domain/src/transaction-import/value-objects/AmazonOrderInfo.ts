/**
 * Amazon 注文情報（Amazon 注文確認メールから抽出）
 * @see docs/domain/08a-ul-取引取込.md §1
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.3
 */
import { z } from 'zod'
import { AmazonOrderIdSchema, UserIdSchema, GmailMessageIdSchema } from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'
import { AmazonProductKeySchema } from '../../shared/value-objects/AmazonProductKey'

export const AmazonProductInfoSchema = z.object({
  productName: z.string().min(1),
  amazonProductKey: AmazonProductKeySchema,
  productAmount: MoneySchema,
})
export type AmazonProductInfo = z.infer<typeof AmazonProductInfoSchema>

// 将来の Amazon 突合機能（注文確認メールとカード明細の自動照合）の足場として残している。
// AmazonProductInfoSchema は TransactionCandidate から参照済み。
export const AmazonOrderInfoSchema = z.object({
  amazonOrderId: AmazonOrderIdSchema,
  userId: UserIdSchema,
  gmailMessageId: GmailMessageIdSchema,
  orderedAt: z.date(),
  orderTotal: MoneySchema,
  products: z.array(AmazonProductInfoSchema).min(1),
})
export type AmazonOrderInfo = z.infer<typeof AmazonOrderInfoSchema>
