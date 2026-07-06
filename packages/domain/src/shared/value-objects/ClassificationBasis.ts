/**
 * 分類根拠（分類済み取引がどのルートで分類されたか）
 * @see docs/domain/08b-ul-自動分類学習.md §1
 * @see docs/domain/08c-ul-家計分析.md §1
 *
 * kawasima: data 分類根拠 = 加盟店ルール根拠 OR Amazon商品キー根拠 OR ユーザー手動修正根拠 OR CSV取込時一括分類根拠
 *
 * 08b/08e は前者 3 種のみを列挙するが、csv_bulk は一括分類セッション（08b）の適用結果として
 * 生成されるため、上位集合 1 本で共有する。
 * Phase 5 M-A で household-analysis から shared へ移設し、`bulkSessionId` / `amazonProductKey` を
 * branded 型へ強化（エクスポート名は不変）。
 */
import { z } from 'zod'
import { UserIdSchema, BulkClassificationSessionIdSchema } from '../ids'
import { AmazonProductKeySchema } from './AmazonProductKey'

export const ClassificationBasisSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('merchant_rule'),
    merchantName: z.string().min(1),
    ruleLastUpdatedAt: z.date(),
  }),
  z.object({
    kind: z.literal('amazon_product_key'),
    amazonProductKey: AmazonProductKeySchema,
    ruleLastUpdatedAt: z.date(),
  }),
  z.object({
    kind: z.literal('user_manual'),
    modifiedByUserId: UserIdSchema,
    modifiedAt: z.date(),
  }),
  z.object({
    kind: z.literal('csv_bulk'),
    bulkSessionId: BulkClassificationSessionIdSchema,
    appliedAt: z.date(),
  }),
])
export type ClassificationBasis = z.infer<typeof ClassificationBasisSchema>
