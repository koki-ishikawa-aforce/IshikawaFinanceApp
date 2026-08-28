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
 * 完了通知は requestedContexts の部分集合でなければならず、同じコンテキストが2件以上並んではならない
 * （依頼していない、または重複したコンテキストからの完了通知は記録しない）。記録すると合算する影響件数に
 * 依頼外・二重の申告分が混ざり、削除完了の記録として残ったあとから真偽を確かめられないため。
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
    const seen = new Set<RemapTargetContext>()
    state.completedContexts.forEach((completion, index) => {
      if (!requested.has(completion.context)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: '依頼していないコンテキストからの完了通知は記録できない',
          path: ['completedContexts', index, 'context'],
        })
      }
      if (seen.has(completion.context)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: '同じコンテキストからの完了通知は重複して記録できない',
          path: ['completedContexts', index, 'context'],
        })
      }
      seen.add(completion.context)
    })
  })
export type DeletionRequestState = z.infer<typeof DeletionRequestStateSchema>

export type RemapRequestedState = Extract<DeletionRequestState, { kind: 'remap_requested' }>

/**
 * 完了通知の送り主が依頼先として記録されているか。
 * 記録されない通知（配線の取り違え）を呼び出し側が観測して記録に残せるよう、判定を公開する。
 */
export function isRequestedRemapContext(
  state: RemapRequestedState,
  context: RemapTargetContext,
): boolean {
  return state.requestedContexts.includes(context)
}

/**
 * 完了通知を1件加えたリマップ依頼済み状態を返す。
 * 次のいずれかに当たる通知は記録せず、受け取った状態をそのまま返す:
 *  - 依頼していないコンテキストからの通知（影響件数の合算に依頼外の申告を混ぜない）
 *  - 記録済みコンテキストからの再通知（at-least-once 配信対策の冪等）
 *
 * カテゴリ・経費種別の削除リクエストで同じ規則を使うため、判定はここに1箇所だけ置く。
 * 記録しなかったことは戻り値の参照が同一であることで判別できる。
 */
export function appendCompletedRemapContext(
  state: RemapRequestedState,
  completion: Omit<CompletedRemapContext, 'completedAt'>,
  at: Date,
): RemapRequestedState {
  if (!isRequestedRemapContext(state, completion.context)) return state
  if (state.completedContexts.some(c => c.context === completion.context)) return state
  return {
    ...state,
    completedContexts: [...state.completedContexts, { ...completion, completedAt: at }],
  }
}
