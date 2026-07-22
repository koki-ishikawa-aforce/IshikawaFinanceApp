import { describe, it, expect } from 'vitest'
import {
  ConsecutiveFailureCounterSchema,
  initialFailureCounter,
  markFailsafeFired,
  recordSendFailure,
  resetFailureCounter,
  shouldFireFailsafe,
  type FailureCounterRef,
} from '../../../src/notification-delivery/value-objects/ConsecutiveFailureCounter'
import { InvariantViolationError } from '../../../src/shared/errors/DomainError'
import { FailsafeEmailIdSchema } from '../../../src/shared/ids'

describe('ConsecutiveFailureCounter 値オブジェクト', () => {
  it('しきい値未到達のカウンタは parse 成功', () => {
    expect(() =>
      ConsecutiveFailureCounterSchema.parse({
        counterRef: { kind: 'user', userId: 'user_honey' as never },
        consecutiveFailureCount: 2,
        lastFailedAt: new Date(),
        thresholdState: { kind: 'not_reached' },
      }),
    ).not.toThrow()
  })

  it('しきい値到達 + フェイルセーフ発火済み（発火には failsafeEmailId が必須）', () => {
    expect(() =>
      ConsecutiveFailureCounterSchema.parse({
        counterRef: { kind: 'talk_room', talkRoomId: 'room_001' as never },
        consecutiveFailureCount: 3,
        lastFailedAt: new Date(),
        thresholdState: {
          kind: 'reached',
          reachedAt: new Date(),
          failsafeState: {
            kind: 'fired',
            firedAt: new Date(),
            failsafeEmailId: '01FSE000000000000000000001' as never,
          },
        },
      }),
    ).not.toThrow()

    expect(() =>
      ConsecutiveFailureCounterSchema.parse({
        counterRef: { kind: 'talk_room', talkRoomId: 'room_001' as never },
        consecutiveFailureCount: 3,
        lastFailedAt: new Date(),
        thresholdState: {
          kind: 'reached',
          reachedAt: new Date(),
          failsafeState: { kind: 'fired', firedAt: new Date() },
        },
      }),
    ).toThrow()
  })

  it('失敗回数が負なら parse 失敗', () => {
    expect(() =>
      ConsecutiveFailureCounterSchema.parse({
        counterRef: { kind: 'user', userId: 'user_honey' as never },
        consecutiveFailureCount: -1,
        lastFailedAt: null,
        thresholdState: { kind: 'not_reached' },
      }),
    ).toThrow()
  })

  it('失敗回数 0 なのにしきい値到達なら parse 失敗（OQ-14 の前提が壊れる）', () => {
    expect(() =>
      ConsecutiveFailureCounterSchema.parse({
        counterRef: { kind: 'user', userId: 'user_honey' as never },
        consecutiveFailureCount: 0,
        lastFailedAt: null,
        thresholdState: {
          kind: 'reached',
          reachedAt: new Date(),
          failsafeState: {
            kind: 'fired',
            firedAt: new Date(),
            failsafeEmailId: '01FSE000000000000000000001' as never,
          },
        },
      }),
    ).toThrow()
  })

  it('失敗回数 0 なのに最終失敗日時ありは parse 失敗', () => {
    expect(() =>
      ConsecutiveFailureCounterSchema.parse({
        counterRef: { kind: 'user', userId: 'user_honey' as never },
        consecutiveFailureCount: 0,
        lastFailedAt: new Date(),
        thresholdState: { kind: 'not_reached' },
      }),
    ).toThrow()
  })

  it('失敗回数 > 0 なのに最終失敗日時が null なら parse 失敗', () => {
    expect(() =>
      ConsecutiveFailureCounterSchema.parse({
        counterRef: { kind: 'user', userId: 'user_honey' as never },
        consecutiveFailureCount: 2,
        lastFailedAt: null,
        thresholdState: { kind: 'not_reached' },
      }),
    ).toThrow()
  })

  it('未失敗の初期状態（0 回・日時なし・未到達）は parse 成功', () => {
    expect(() =>
      ConsecutiveFailureCounterSchema.parse({
        counterRef: { kind: 'user', userId: 'user_honey' as never },
        consecutiveFailureCount: 0,
        lastFailedAt: null,
        thresholdState: { kind: 'not_reached' },
      }),
    ).not.toThrow()
  })
})

describe('ConsecutiveFailureCounter 状態遷移', () => {
  const ref: FailureCounterRef = { kind: 'talk_room', talkRoomId: 'room_001' as never }
  const failsafeEmailId = FailsafeEmailIdSchema.parse('01HZX3F2M9GQ4T8VWYJ5KNBC6D')

  it('initialFailureCounter は 0 回・未到達で生成する', () => {
    const counter = initialFailureCounter(ref)
    expect(counter.consecutiveFailureCount).toBe(0)
    expect(counter.lastFailedAt).toBeNull()
    expect(counter.thresholdState.kind).toBe('not_reached')
  })

  it('recordSendFailure はカウンタ +1 し、しきい値未満なら未到達のまま', () => {
    const at = new Date('2026-07-01T00:00:00Z')
    const counter = recordSendFailure(initialFailureCounter(ref), at, 3)
    expect(counter.consecutiveFailureCount).toBe(1)
    expect(counter.lastFailedAt).toEqual(at)
    expect(counter.thresholdState.kind).toBe('not_reached')
    expect(shouldFireFailsafe(counter)).toBe(false)
  })

  it('しきい値到達で reached（未発火）へ遷移し shouldFireFailsafe が真になる', () => {
    const at = new Date('2026-07-01T00:00:00Z')
    let counter = initialFailureCounter(ref)
    for (let i = 0; i < 3; i++) counter = recordSendFailure(counter, at, 3)
    expect(counter.consecutiveFailureCount).toBe(3)
    expect(counter.thresholdState).toEqual({
      kind: 'reached',
      reachedAt: at,
      failsafeState: { kind: 'not_fired' },
    })
    expect(shouldFireFailsafe(counter)).toBe(true)
  })

  it('到達済みカウンタへの追加失敗は到達日時・発火状態を維持する（再到達扱いにしない）', () => {
    const reachedAt = new Date('2026-07-01T00:00:00Z')
    let counter = initialFailureCounter(ref)
    for (let i = 0; i < 3; i++) counter = recordSendFailure(counter, reachedAt, 3)
    const fired = markFailsafeFired(counter, failsafeEmailId, reachedAt)
    const after = recordSendFailure(fired, new Date('2026-07-02T00:00:00Z'), 3)
    expect(after.consecutiveFailureCount).toBe(4)
    expect(after.thresholdState).toEqual(fired.thresholdState)
    expect(shouldFireFailsafe(after)).toBe(false)
  })

  it('markFailsafeFired は到達済み・未発火のカウンタを発火済みへ遷移する', () => {
    const at = new Date('2026-07-01T00:00:00Z')
    let counter = initialFailureCounter(ref)
    for (let i = 0; i < 3; i++) counter = recordSendFailure(counter, at, 3)
    const fired = markFailsafeFired(counter, failsafeEmailId, at)
    expect(fired.thresholdState).toEqual({
      kind: 'reached',
      reachedAt: at,
      failsafeState: { kind: 'fired', firedAt: at, failsafeEmailId },
    })
  })

  it('markFailsafeFired は未到達・発火済みカウンタには適用できない（1 回だけ発火、OQ-14）', () => {
    const at = new Date('2026-07-01T00:00:00Z')
    expect(() => markFailsafeFired(initialFailureCounter(ref), failsafeEmailId, at)).toThrow(
      InvariantViolationError,
    )
    let counter = initialFailureCounter(ref)
    for (let i = 0; i < 3; i++) counter = recordSendFailure(counter, at, 3)
    const fired = markFailsafeFired(counter, failsafeEmailId, at)
    expect(() => markFailsafeFired(fired, failsafeEmailId, at)).toThrow(InvariantViolationError)
  })

  it('resetFailureCounter は送信成功で初期状態へ戻す（0 回なら同一参照を返す）', () => {
    const at = new Date('2026-07-01T00:00:00Z')
    let counter = initialFailureCounter(ref)
    counter = recordSendFailure(counter, at, 3)
    const reset = resetFailureCounter(counter)
    expect(reset.consecutiveFailureCount).toBe(0)
    expect(reset.thresholdState.kind).toBe('not_reached')
    const initial = initialFailureCounter(ref)
    expect(resetFailureCounter(initial)).toBe(initial)
  })
})
