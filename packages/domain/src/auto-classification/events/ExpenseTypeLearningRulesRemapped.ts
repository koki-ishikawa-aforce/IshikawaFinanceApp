import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { ExpenseTypeDeletionRequestIdSchema } from '../../shared/ids'

/**
 * 経費種別削除リマップ: 自動分類学習完了通知（08h §2「自動分類学習完了通知」）。
 *
 * 経費種別削除リマップ要請を受け、対象経費種別を学習していた加盟店ルールを移動先へ付け替え終えたことをマスタ管理のコーディネーターへ知らせる。
 */
export const ExpenseTypeLearningRulesRemappedSchema = DomainEventBaseSchema.extend({
  type: z.literal('ExpenseTypeLearningRulesRemapped'),
  expenseTypeDeletionRequestId: ExpenseTypeDeletionRequestIdSchema,
  affectedLearningRuleCount: z.number().int().nonnegative(),
})
export type ExpenseTypeLearningRulesRemapped = z.infer<
  typeof ExpenseTypeLearningRulesRemappedSchema
>
