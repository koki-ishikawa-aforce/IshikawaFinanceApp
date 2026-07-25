import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { CategoryDeletionRequestIdSchema } from '../../shared/ids'

/**
 * カテゴリ削除リマップ: 家計分析完了通知（08h §2「家計分析完了通知」）。
 *
 * カテゴリ削除リマップ要請を受け、対象カテゴリの取引を移動先へ付け替え終えたことを
 * マスタ管理のコーディネーターへ知らせる。occurredAt を完了日時として扱う。
 */
export const CategoryTransactionsRemappedSchema = DomainEventBaseSchema.extend({
  type: z.literal('CategoryTransactionsRemapped'),
  categoryDeletionRequestId: CategoryDeletionRequestIdSchema,
  affectedTransactionCount: z.number().int().nonnegative(),
})
export type CategoryTransactionsRemapped = z.infer<typeof CategoryTransactionsRemappedSchema>
