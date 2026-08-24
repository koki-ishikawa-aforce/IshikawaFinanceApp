/**
 * Amazon 注文情報（Amazon 注文確認メールから抽出）
 * @see docs/domain/08a-ul-取引取込.md §1
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.3
 */
import { z } from 'zod'
import { AmazonOrderIdSchema, UserIdSchema, GmailMessageIdSchema } from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'

/**
 * 注文確認メールから実際に取り出せる項目だけを持つ（商品名・金額）。
 * 商品カテゴリ（旧 Amazon商品キー）はメールに含まれないことが実メール調査で判明したため、
 * X-1 の取り下げ（2026-08-23 / #391・#572）に伴い削除した。
 */
/**
 * 上限は、外部から届くメール本文（1 通あたり最大 256KB）がそのまま取引候補の payload に
 * 入らないようにするための歯止め。読み取り規則を緩めたときに、本文まるごとが商品名として
 * 保存されることを防ぐ。超過はスキーマ違反 → パース失敗として件数に出る（取込は止まらない）。
 */
export const AmazonProductInfoSchema = z.object({
  productName: z.string().min(1).max(200),
  productAmount: MoneySchema,
})
export type AmazonProductInfo = z.infer<typeof AmazonProductInfoSchema>

// 注文確認メールとカード利用通知の突合（#391）が使う。パースは
// parseAmazonOrderConfirmationMail、突合は matchAmazonOrders。
export const AmazonOrderInfoSchema = z.object({
  amazonOrderId: AmazonOrderIdSchema,
  userId: UserIdSchema,
  gmailMessageId: GmailMessageIdSchema,
  orderedAt: z.date(),
  orderTotal: MoneySchema,
  products: z.array(AmazonProductInfoSchema).min(1).max(100),
})
export type AmazonOrderInfo = z.infer<typeof AmazonOrderInfoSchema>
