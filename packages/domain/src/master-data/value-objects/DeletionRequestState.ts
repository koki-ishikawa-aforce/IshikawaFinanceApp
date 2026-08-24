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

/**
 * 依頼先コンテキストからのリマップ完了通知の記録（08h §1「完了したコンテキスト」）。
 * コーディネーターが各コンテキストの完了通知イベントを受け取るたびに1件追加し、
 * requestedContexts が全て出そろった時点で物理削除へ進む（R-2 改）。
 * 影響取引数は取引を扱うコンテキスト、影響学習ルール数は自動分類・学習が報告する
 * （報告しない側は 0）。物理削除時に全コンテキスト分を合算して remap_completed に記録する。
 *
 * 完了通知は requestedContexts の部分集合でなければならない（依頼していないコンテキストからの
 * 完了通知は記録しない）。記録すると合算する影響件数に依頼外の申告分が混ざり、削除完了の記録
 * として残ったあとから真偽を確かめられないため。
 */
export const CompletedRemapContextSchema = z.object({
  context: RemapTargetContextSchema,
  affectedTransactionCount: z.number().int().nonnegative(),
  affectedLearningRuleCount: z.number().int().nonnegative(),
  completedAt: z.date(),
})
export type CompletedRemapContext = z.infer<typeof CompletedRemapContextSchema>

export const DeletionRequestStateSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('pending_remap') }),
    z.object({
      kind: z.literal('remap_requested'),
      requestedAt: z.date(),
      requestedContexts: z.array(RemapTargetContextSchema).min(1),
      completedContexts: z.array(CompletedRemapContextSchema).default([]),
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
  .superRefine((state, ctx) => {
    if (state.kind !== 'remap_requested') return
    const requested = new Set(state.requestedContexts)
    state.completedContexts.forEach((completion, index) => {
      if (requested.has(completion.context)) return
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '依頼していない依頼先コンテキストの完了通知は記録できない',
        path: ['completedContexts', index, 'context'],
      })
    })
  })
export type DeletionRequestState = z.infer<typeof DeletionRequestStateSchema>
