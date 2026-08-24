import { z } from 'zod'
import {
  CategoryDeletionRequestIdSchema,
  CategoryIdSchema,
  ExpenseTypeIdSchema,
  UserIdSchema,
} from '../../shared/ids'
import { ExpenseClassSchema } from '../../shared/value-objects/ExpenseClass'
import { DeletionRequestStateSchema, appendCompletedRemapContext } from './DeletionRequestState'
import type {
  CompletedRemapContext,
  DeletionRequestState,
  RemapTargetContext,
} from './DeletionRequestState'

/**
 * カテゴリ削除リクエスト
 * @see docs/domain/08h-ul-マスタ管理.md §1
 *
 * 09-aggregates.md 上の集約ルートではないため value-objects として型化。
 * 削除時は移動先カテゴリID が必ず設定される（孤立取引を作らない）。
 *
 * 不変条件:
 *  - 移動先費用区分 = 経費(会社) の場合は移動先経費種別ID 必須（取引の不変条件を維持）
 *  - 状態遷移は pending_remap → remap_requested → remap_completed | remap_failed の一方向のみ
 */
export const CategoryDeletionRequestSchema = z
  .object({
    categoryDeletionRequestId: CategoryDeletionRequestIdSchema,
    targetCategoryId: CategoryIdSchema,
    requestedByUserId: UserIdSchema,
    destinationCategoryId: CategoryIdSchema,
    destinationExpenseClass: ExpenseClassSchema,
    destinationExpenseTypeId: ExpenseTypeIdSchema.optional(),
    requestedAt: z.date(),
    state: DeletionRequestStateSchema,
  })
  .superRefine((request, ctx) => {
    if (
      request.destinationExpenseClass === 'business_expense' &&
      request.destinationExpenseTypeId === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '移動先費用区分が経費(会社)の場合は移動先経費種別ID が必須',
        path: ['destinationExpenseTypeId'],
      })
    }
    if (
      request.destinationExpenseClass !== 'business_expense' &&
      request.destinationExpenseTypeId !== undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '移動先費用区分が経費(会社)以外の場合は移動先経費種別ID を指定できない',
        path: ['destinationExpenseTypeId'],
      })
    }
  })
export type CategoryDeletionRequest = z.infer<typeof CategoryDeletionRequestSchema>

export type PendingRemapCategoryDeletionRequest = CategoryDeletionRequest & {
  state: Extract<DeletionRequestState, { kind: 'pending_remap' }>
}
export type RemapRequestedCategoryDeletionRequest = CategoryDeletionRequest & {
  state: Extract<DeletionRequestState, { kind: 'remap_requested' }>
}
export type RemapCompletedCategoryDeletionRequest = CategoryDeletionRequest & {
  state: Extract<DeletionRequestState, { kind: 'remap_completed' }>
}
export type RemapFailedCategoryDeletionRequest = CategoryDeletionRequest & {
  state: Extract<DeletionRequestState, { kind: 'remap_failed' }>
}

/** 状態遷移: リマップ依頼前 → リマップ依頼済み */
export function requestCategoryRemap(
  request: PendingRemapCategoryDeletionRequest,
  requestedContexts: RemapTargetContext[],
  at: Date,
): RemapRequestedCategoryDeletionRequest {
  return CategoryDeletionRequestSchema.parse({
    ...request,
    state: { kind: 'remap_requested', requestedAt: at, requestedContexts },
  }) as RemapRequestedCategoryDeletionRequest
}

/**
 * 依頼先コンテキストからのリマップ完了通知を1件記録する（remap_requested のまま）。
 * 冪等: 同一コンテキストの通知が再配信されても二重に記録しない（at-least-once 配信対策）。
 * 依頼していないコンテキストからの完了通知は記録せず捨てる（影響件数に依頼外の申告を混ぜない）。
 */
export function recordCategoryRemapContextCompletion(
  request: RemapRequestedCategoryDeletionRequest,
  completion: Omit<CompletedRemapContext, 'completedAt'>,
  at: Date,
): RemapRequestedCategoryDeletionRequest {
  const state = appendCompletedRemapContext(request.state, completion, at)
  if (state === request.state) {
    return request
  }
  return CategoryDeletionRequestSchema.parse({
    ...request,
    state,
  }) as RemapRequestedCategoryDeletionRequest
}

/** 依頼先コンテキストが全て完了通知を返したか（物理削除の前提条件） */
export function isCategoryRemapFullyCompleted(
  request: RemapRequestedCategoryDeletionRequest,
): boolean {
  const completed = new Set(request.state.completedContexts.map(c => c.context))
  return request.state.requestedContexts.every(context => completed.has(context))
}

/**
 * 状態遷移: リマップ依頼済み → リマップ完了。
 * 影響件数は記録済みの各コンテキスト完了通知を合算して確定する。
 */
export function completeCategoryRemap(
  request: RemapRequestedCategoryDeletionRequest,
  at: Date,
): RemapCompletedCategoryDeletionRequest {
  const affectedTransactionCount = request.state.completedContexts.reduce(
    (sum, c) => sum + c.affectedTransactionCount,
    0,
  )
  const affectedLearningRuleCount = request.state.completedContexts.reduce(
    (sum, c) => sum + c.affectedLearningRuleCount,
    0,
  )
  return CategoryDeletionRequestSchema.parse({
    ...request,
    state: {
      kind: 'remap_completed',
      completedAt: at,
      affectedTransactionCount,
      affectedLearningRuleCount,
    },
  }) as RemapCompletedCategoryDeletionRequest
}

/** 状態遷移: リマップ依頼済み → リマップ失敗 */
export function failCategoryRemap(
  request: RemapRequestedCategoryDeletionRequest,
  failureDetail: string,
  at: Date,
): RemapFailedCategoryDeletionRequest {
  return CategoryDeletionRequestSchema.parse({
    ...request,
    state: { kind: 'remap_failed', failedAt: at, failureDetail },
  }) as RemapFailedCategoryDeletionRequest
}
