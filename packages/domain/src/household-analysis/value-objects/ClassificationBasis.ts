/**
 * 分類根拠（分類済み取引がどのルートで分類されたか）
 * @see docs/domain/08c-ul-家計分析.md §1
 *
 * kawasima: data 分類根拠 = 加盟店ルール根拠 OR Amazon商品キー根拠 OR ユーザー手動修正根拠 OR CSV取込時一括分類根拠
 */
import { z } from 'zod'
import { UserIdSchema } from '../../shared/ids'

export const ClassificationBasisSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('merchant_rule'),
    merchantName: z.string().min(1),
    ruleLastUpdatedAt: z.date(),
  }),
  z.object({
    kind: z.literal('amazon_product_key'),
    amazonProductKey: z.string().min(1),
    ruleLastUpdatedAt: z.date(),
  }),
  z.object({
    kind: z.literal('user_manual'),
    modifiedByUserId: UserIdSchema,
    modifiedAt: z.date(),
  }),
  z.object({
    kind: z.literal('csv_bulk'),
    bulkSessionId: z.string().min(1),
    appliedAt: z.date(),
  }),
])
export type ClassificationBasis = z.infer<typeof ClassificationBasisSchema>
