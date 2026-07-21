import { z } from 'zod'
import {
  ExpenseTypeDeletionRequestIdSchema,
  ExpenseTypeIdSchema,
  UserIdSchema,
} from '../../shared/ids'
import { DeletionRequestStateSchema } from './DeletionRequestState'
import type { DeletionRequestState, RemapTargetContext } from './DeletionRequestState'

/**
 * 経費種別削除リクエスト
 * @see docs/domain/08h-ul-マスタ管理.md §1
 *
 * 削除時は移動先経費種別ID が必ず設定される。
 * リマップ後も取引は経費(会社)のままであるため移動先費用区分は持たない。
 *
 * 不変条件:
 *  - 状態遷移は pending_remap → remap_requested → remap_completed | remap_failed の一方向のみ
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

export type PendingRemapExpenseTypeDeletionRequest = ExpenseTypeDeletionRequest & {
  state: Extract<DeletionRequestState, { kind: 'pending_remap' }>
}
export type RemapRequestedExpenseTypeDeletionRequest = ExpenseTypeDeletionRequest & {
  state: Extract<DeletionRequestState, { kind: 'remap_requested' }>
}
export type RemapCompletedExpenseTypeDeletionRequest = ExpenseTypeDeletionRequest & {
  state: Extract<DeletionRequestState, { kind: 'remap_completed' }>
}
export type RemapFailedExpenseTypeDeletionRequest = ExpenseTypeDeletionRequest & {
  state: Extract<DeletionRequestState, { kind: 'remap_failed' }>
}

/** 状態遷移: リマップ依頼前 → リマップ依頼済み */
export function requestExpenseTypeRemap(
  request: PendingRemapExpenseTypeDeletionRequest,
  requestedContexts: RemapTargetContext[],
  at: Date,
): RemapRequestedExpenseTypeDeletionRequest {
  return ExpenseTypeDeletionRequestSchema.parse({
    ...request,
    state: { kind: 'remap_requested', requestedAt: at, requestedContexts },
  }) as RemapRequestedExpenseTypeDeletionRequest
}

/** 状態遷移: リマップ依頼済み → リマップ完了 */
export function completeExpenseTypeRemap(
  request: RemapRequestedExpenseTypeDeletionRequest,
  counts: { affectedTransactionCount: number; affectedLearningRuleCount: number },
  at: Date,
): RemapCompletedExpenseTypeDeletionRequest {
  return ExpenseTypeDeletionRequestSchema.parse({
    ...request,
    state: {
      kind: 'remap_completed',
      completedAt: at,
      affectedTransactionCount: counts.affectedTransactionCount,
      affectedLearningRuleCount: counts.affectedLearningRuleCount,
    },
  }) as RemapCompletedExpenseTypeDeletionRequest
}

/** 状態遷移: リマップ依頼済み → リマップ失敗 */
export function failExpenseTypeRemap(
  request: RemapRequestedExpenseTypeDeletionRequest,
  failureDetail: string,
  at: Date,
): RemapFailedExpenseTypeDeletionRequest {
  return ExpenseTypeDeletionRequestSchema.parse({
    ...request,
    state: { kind: 'remap_failed', failedAt: at, failureDetail },
  }) as RemapFailedExpenseTypeDeletionRequest
}
