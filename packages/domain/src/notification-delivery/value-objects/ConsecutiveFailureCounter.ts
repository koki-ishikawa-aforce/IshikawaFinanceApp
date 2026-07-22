import { z } from 'zod'
import {
  TalkRoomIdSchema,
  UserIdSchema,
  FailsafeEmailIdSchema,
  type FailsafeEmailId,
} from '../../shared/ids'
import { InvariantViolationError } from '../../shared/errors/DomainError'
import type { DeliveryTarget } from './DeliveryTarget'

/**
 * 連続失敗カウンタ（しきい値到達でフェイルセーフメールを発火）
 * @see docs/domain/08g-ul-通知配信.md §1
 *
 * 単発失敗は完全スキップ（ログのみ、論点23）。連続失敗のみカウントし、
 * しきい値到達でフェイルセーフメールを 1 回だけ発火する（OQ-14）。
 *
 * 不変条件（superRefine）:
 *  - 連続失敗回数 = 0 ⇒ 最終失敗日時なし かつ しきい値未到達
 *  - 連続失敗回数 > 0 ⇒ 最終失敗日時あり
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

export const ConsecutiveFailureCounterSchema = z
  .object({
    counterRef: FailureCounterRefSchema,
    consecutiveFailureCount: z.number().int().nonnegative(),
    lastFailedAt: z.date().nullable(),
    thresholdState: ThresholdStateSchema,
  })
  .superRefine((counter, ctx) => {
    if (counter.consecutiveFailureCount === 0) {
      if (counter.lastFailedAt !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: '連続失敗回数 0 のカウンタに最終失敗日時が設定されている',
          path: ['lastFailedAt'],
        })
      }
      if (counter.thresholdState.kind === 'reached') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: '連続失敗回数 0 のカウンタがしきい値到達状態になっている',
          path: ['thresholdState'],
        })
      }
    } else if (counter.lastFailedAt === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `連続失敗回数 ${counter.consecutiveFailureCount} のカウンタに最終失敗日時がない`,
        path: ['lastFailedAt'],
      })
    }
  })
export type ConsecutiveFailureCounter = z.infer<typeof ConsecutiveFailureCounterSchema>

/**
 * フェイルセーフ発火しきい値の既定値（OQ-14: 具体値は実装で決定 → 3 回連続失敗で発火）。
 * 呼出し側（api 層）が環境設定で上書きできる。
 */
export const DEFAULT_FAILSAFE_FAILURE_THRESHOLD = 3

/**
 * 配信先 → 連続失敗カウンタの参照単位
 * （08g §1: data 連続失敗カウンタ = ユーザーID OR 共通トークルームID）
 */
export function counterRefOf(target: DeliveryTarget): FailureCounterRef {
  return target.kind === 'shared_talk_room'
    ? { kind: 'talk_room', talkRoomId: target.talkRoomId }
    : { kind: 'user', userId: target.userId }
}

/** 失敗履歴のない初期カウンタを生成する */
export function initialFailureCounter(counterRef: FailureCounterRef): ConsecutiveFailureCounter {
  return ConsecutiveFailureCounterSchema.parse({
    counterRef,
    consecutiveFailureCount: 0,
    lastFailedAt: null,
    thresholdState: { kind: 'not_reached' },
  })
}

/**
 * 単発送信失敗を記録する（08g §2「単発送信失敗を記録する」: カウンタ +1）。
 * しきい値に到達したら到達状態へ遷移する（既到達なら到達日時・発火状態を維持し、
 * 再到達扱いにしない — フェイルセーフは 1 回だけ発火する、OQ-14）。
 */
export function recordSendFailure(
  counter: ConsecutiveFailureCounter,
  failedAt: Date,
  threshold: number = DEFAULT_FAILSAFE_FAILURE_THRESHOLD,
): ConsecutiveFailureCounter {
  const count = counter.consecutiveFailureCount + 1
  const thresholdState: ThresholdState =
    counter.thresholdState.kind === 'reached'
      ? counter.thresholdState
      : count >= threshold
        ? { kind: 'reached', reachedAt: failedAt, failsafeState: { kind: 'not_fired' } }
        : { kind: 'not_reached' }
  return ConsecutiveFailureCounterSchema.parse({
    counterRef: counter.counterRef,
    consecutiveFailureCount: count,
    lastFailedAt: failedAt,
    thresholdState,
  })
}

/** 送信成功で連続失敗を断ち切り、初期状態へ戻す（連続失敗のみカウントする、論点23） */
export function resetFailureCounter(counter: ConsecutiveFailureCounter): ConsecutiveFailureCounter {
  if (counter.consecutiveFailureCount === 0) return counter
  return initialFailureCounter(counter.counterRef)
}

/** しきい値到達済みかつフェイルセーフ未発火（= フェイルセーフメールを生成すべき状態）か */
export function shouldFireFailsafe(counter: ConsecutiveFailureCounter): boolean {
  return (
    counter.thresholdState.kind === 'reached' &&
    counter.thresholdState.failsafeState.kind === 'not_fired'
  )
}

/** フェイルセーフメール発火を記録する（しきい値到達済み・未発火のときのみ。1 回だけ発火、OQ-14） */
export function markFailsafeFired(
  counter: ConsecutiveFailureCounter,
  failsafeEmailId: FailsafeEmailId,
  firedAt: Date,
): ConsecutiveFailureCounter {
  if (!shouldFireFailsafe(counter) || counter.thresholdState.kind !== 'reached') {
    throw new InvariantViolationError(
      'フェイルセーフ発火はしきい値到達済み・未発火のカウンタに対してのみ記録できる',
    )
  }
  return ConsecutiveFailureCounterSchema.parse({
    ...counter,
    thresholdState: {
      kind: 'reached',
      reachedAt: counter.thresholdState.reachedAt,
      failsafeState: { kind: 'fired', firedAt, failsafeEmailId },
    },
  })
}
