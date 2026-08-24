import { z } from 'zod'
import {
  ExpenseTypeDeletionRequestIdSchema,
  ExpenseTypeIdSchema,
  UserIdSchema,
} from '../../shared/ids'
import { DeletionRequestStateSchema, appendCompletedRemapContext } from './DeletionRequestState'
import type {
  CompletedRemapContext,
  DeletionRequestState,
  RemapTargetContext,
} from './DeletionRequestState'

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

/**
 * 依頼先コンテキストからのリマップ完了通知を1件記録する（remap_requested のまま）。
 * 冪等: 同一コンテキストの通知が再配信されても二重に記録しない（at-least-once 配信対策）。
 * 依頼していないコンテキストからの完了通知は記録せず捨てる（影響件数に依頼外の申告を混ぜない）。
 */
export function recordExpenseTypeRemapContextCompletion(
  request: RemapRequestedExpenseTypeDeletionRequest,
  completion: Omit<CompletedRemapContext, 'completedAt'>,
  at: Date,
): RemapRequestedExpenseTypeDeletionRequest {
  const state = appendCompletedRemapContext(request.state, completion, at)
  if (state === request.state) {
    return request
  }
  return ExpenseTypeDeletionRequestSchema.parse({
    ...request,
    state,
  }) as RemapRequestedExpenseTypeDeletionRequest
}

/** 依頼先コンテキストが全て完了通知を返したか（物理削除の前提条件） */
export function isExpenseTypeRemapFullyCompleted(
  request: RemapRequestedExpenseTypeDeletionRequest,
): boolean {
  const completed = new Set(request.state.completedContexts.map(c => c.context))
  return request.state.requestedContexts.every(context => completed.has(context))
}

/**
 * 状態遷移: リマップ依頼済み → リマップ完了。
 * 影響件数は記録済みの各コンテキスト完了通知を合算して確定する。
 */
export function completeExpenseTypeRemap(
  request: RemapRequestedExpenseTypeDeletionRequest,
  at: Date,
): RemapCompletedExpenseTypeDeletionRequest {
  const affectedTransactionCount = request.state.completedContexts.reduce(
    (sum, c) => sum + c.affectedTransactionCount,
    0,
  )
  const affectedLearningRuleCount = request.state.completedContexts.reduce(
    (sum, c) => sum + c.affectedLearningRuleCount,
    0,
  )
  return ExpenseTypeDeletionRequestSchema.parse({
    ...request,
    state: {
      kind: 'remap_completed',
      completedAt: at,
      affectedTransactionCount,
      affectedLearningRuleCount,
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
