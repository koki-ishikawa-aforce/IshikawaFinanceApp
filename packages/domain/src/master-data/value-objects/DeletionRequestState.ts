import { z } from 'zod'

/**
 * 削除リクエスト状態（リマップ状態機械）
 * @see docs/domain/08h-ul-マスタ管理.md §1
 *
 * 物理削除は全依頼先コンテキストからのリマップ完了通知後にのみ行う（R-2 改）。
 */
export const RemapTargetContextSchema = z.enum([
  'household_analysis',
  'expense_settlement',
  'auto_classification',
])
export type RemapTargetContext = z.infer<typeof RemapTargetContextSchema>

export const DeletionRequestStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pending_remap') }),
  z.object({
    kind: z.literal('remap_requested'),
    requestedAt: z.date(),
    requestedContexts: z.array(RemapTargetContextSchema).min(1),
  }),
  z.object({
    kind: z.literal('remap_completed'),
    completedAt: z.date(),
    affectedTransactionCount: z.number().int().nonnegative(),
    affectedLearningRuleCount: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('remap_failed'),
    failedAt: z.date(),
    failureDetail: z.string().min(1),
  }),
])
export type DeletionRequestState = z.infer<typeof DeletionRequestStateSchema>
