import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { AmazonOrderIdSchema, UserIdSchema } from '../../shared/ids'

/**
 * Amazon商品情報抽出イベント（08a §3）
 *
 * 注文確認メールから取り出せる商品名を運ぶ。X-1 の取り下げ（2026-08-23 / #391・#572）で
 * 商品カテゴリ（旧 Amazon商品キー）は抽出対象から外れたため、本イベントも商品名を運ぶ。
 */
export const AmazonProductInfoExtractedSchema = DomainEventBaseSchema.extend({
  type: z.literal('AmazonProductInfoExtracted'),
  amazonOrderId: AmazonOrderIdSchema,
  userId: UserIdSchema,
  productNames: z.array(z.string().min(1)),
})
export type AmazonProductInfoExtracted = z.infer<typeof AmazonProductInfoExtractedSchema>
