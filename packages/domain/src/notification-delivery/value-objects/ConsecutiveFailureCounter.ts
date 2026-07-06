import { z } from 'zod'
import { TalkRoomIdSchema, UserIdSchema, FailsafeEmailIdSchema } from '../../shared/ids'

/**
 * 連続失敗カウンタ（しきい値到達でフェイルセーフメールを発火）
 * @see docs/domain/08g-ul-通知配信.md §1
 *
 * 単発失敗は完全スキップ（ログのみ、論点23）。連続失敗のみカウントし、
 * しきい値到達でフェイルセーフメールを 1 回だけ発火する（OQ-14）。
 */
export const FailureCounterRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), userId: UserIdSchema }),
  z.object({ kind: z.literal('talk_room'), talkRoomId: TalkRoomIdSchema }),
])
export type FailureCounterRef = z.infer<typeof FailureCounterRefSchema>

export const FailsafeTriggerStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('not_fired') }),
  z.object({
    kind: z.literal('fired'),
    firedAt: z.date(),
    failsafeEmailId: FailsafeEmailIdSchema,
  }),
])
export type FailsafeTriggerState = z.infer<typeof FailsafeTriggerStateSchema>

export const ThresholdStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('not_reached') }),
  z.object({
    kind: z.literal('reached'),
    reachedAt: z.date(),
    failsafeState: FailsafeTriggerStateSchema,
  }),
])
export type ThresholdState = z.infer<typeof ThresholdStateSchema>

export const ConsecutiveFailureCounterSchema = z.object({
  counterRef: FailureCounterRefSchema,
  consecutiveFailureCount: z.number().int().nonnegative(),
  lastFailedAt: z.date().nullable(),
  thresholdState: ThresholdStateSchema,
})
export type ConsecutiveFailureCounter = z.infer<typeof ConsecutiveFailureCounterSchema>
