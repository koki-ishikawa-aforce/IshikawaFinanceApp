/**
 * 配偶者完了検知結果（論点19: 画面ロード時のみ判定、ポーリング/WebSocket なし）
 * @see docs/domain/08f-ul-オンボーディング認証.md §1
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.4
 *
 * kawasima: data 配偶者完了検知結果 = 配偶者待ち OR 両者完了済み
 */
import { z } from 'zod'
import { UserIdSchema } from '../../shared/ids'

export const SpouseCompletionResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('awaiting_spouse'),
    userId: UserIdSchema,
    spouseUserId: UserIdSchema,
    detectedAt: z.date(),
  }),
  z.object({
    kind: z.literal('both_completed'),
    honeyUserId: UserIdSchema,
    darlingUserId: UserIdSchema,
    bothCompletedAt: z.date(),
  }),
])
export type SpouseCompletionResult = z.infer<typeof SpouseCompletionResultSchema>
