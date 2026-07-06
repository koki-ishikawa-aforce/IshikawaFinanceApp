import { z } from 'zod'
import { CategoryDeletionRequestIdSchema, CategoryIdSchema, UserIdSchema } from '../../shared/ids'
import { ExpenseClassSchema } from '../../shared/value-objects/ExpenseClass'
import { DeletionRequestStateSchema } from './DeletionRequestState'

/**
 * カテゴリ削除リクエスト
 * @see docs/domain/08h-ul-マスタ管理.md §1
 *
 * 09-aggregates.md 上の集約ルートではないため value-objects として型化。
 * 削除時は移動先カテゴリID が必ず設定される（孤立取引を作らない）。
 */
export const CategoryDeletionRequestSchema = z.object({
  categoryDeletionRequestId: CategoryDeletionRequestIdSchema,
  targetCategoryId: CategoryIdSchema,
  requestedByUserId: UserIdSchema,
  destinationCategoryId: CategoryIdSchema,
  destinationExpenseClass: ExpenseClassSchema,
  requestedAt: z.date(),
  state: DeletionRequestStateSchema,
})
export type CategoryDeletionRequest = z.infer<typeof CategoryDeletionRequestSchema>
