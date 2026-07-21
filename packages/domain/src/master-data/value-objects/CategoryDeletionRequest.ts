import { z } from 'zod'
import {
  CategoryDeletionRequestIdSchema,
  CategoryIdSchema,
  ExpenseTypeIdSchema,
  UserIdSchema,
} from '../../shared/ids'
import { ExpenseClassSchema } from '../../shared/value-objects/ExpenseClass'
import { DeletionRequestStateSchema } from './DeletionRequestState'
import type { DeletionRequestState, RemapTargetContext } from './DeletionRequestState'

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

/** 状態遷移: リマップ依頼済み → リマップ完了 */
export function completeCategoryRemap(
  request: RemapRequestedCategoryDeletionRequest,
  counts: { affectedTransactionCount: number; affectedLearningRuleCount: number },
  at: Date,
): RemapCompletedCategoryDeletionRequest {
  return CategoryDeletionRequestSchema.parse({
    ...request,
    state: {
      kind: 'remap_completed',
      completedAt: at,
      affectedTransactionCount: counts.affectedTransactionCount,
      affectedLearningRuleCount: counts.affectedLearningRuleCount,
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
