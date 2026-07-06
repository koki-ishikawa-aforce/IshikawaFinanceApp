/**
 * Amazon 商品キー値オブジェクト
 * @see docs/domain/08b-ul-自動分類学習.md §1
 *
 * kawasima: data Amazon商品キー = 文字列（Amazon 注文確認メールから抽出した商品カテゴリ表記、例: "本"）
 *
 * X-1 特例: 加盟店名「AMAZON.CO.JP」は加盟店学習の対象外であり、代わりに本キーで学習する。
 * 粒度・標準化は OQ-35（Phase 5 中に確定）。
 */
import { z } from 'zod'

export const AmazonProductKeySchema = z.string().min(1).brand<'AmazonProductKey'>()
export type AmazonProductKey = z.infer<typeof AmazonProductKeySchema>
