import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { CategoryDeletionRequestIdSchema } from '../../shared/ids'

/**
 * カテゴリ削除リマップ: 自動分類学習完了通知（08h §2「自動分類学習完了通知」）。
 *
 * カテゴリ削除リマップ要請を受け、対象カテゴリを学習していた加盟店ルール・Amazon 商品キー
 * ルールを移動先へ付け替え終えたことをマスタ管理のコーディネーターへ知らせる。
 */
export const CategoryLearningRulesRemappedSchema = DomainEventBaseSchema.extend({
  type: z.literal('CategoryLearningRulesRemapped'),
  categoryDeletionRequestId: CategoryDeletionRequestIdSchema,
  affectedLearningRuleCount: z.number().int().nonnegative(),
})
export type CategoryLearningRulesRemapped = z.infer<typeof CategoryLearningRulesRemappedSchema>
