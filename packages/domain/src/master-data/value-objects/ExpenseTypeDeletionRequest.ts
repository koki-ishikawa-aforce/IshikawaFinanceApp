import { z } from 'zod'
import {
  ExpenseTypeDeletionRequestIdSchema,
  ExpenseTypeIdSchema,
  UserIdSchema,
} from '../../shared/ids'
import { DeletionRequestStateSchema } from './DeletionRequestState'

/**
 * 経費種別削除リクエスト
 * @see docs/domain/08h-ul-マスタ管理.md §1
 *
 * 削除時は移動先経費種別ID が必ず設定される。
 */
export const ExpenseTypeDeletionRequestSchema = z.object({
  expenseTypeDeletionRequestId: ExpenseTypeDeletionRequestIdSchema,
  targetExpenseTypeId: ExpenseTypeIdSchema,
  requestedByUserId: UserIdSchema,
  destinationExpenseTypeId: ExpenseTypeIdSchema,
  requestedAt: z.date(),
  state: DeletionRequestStateSchema,
})
export type ExpenseTypeDeletionRequest = z.infer<typeof ExpenseTypeDeletionRequestSchema>
