import { describe, it, expect } from 'vitest'
import { ConsecutiveFailureCounterSchema } from '../../../src/notification-delivery/value-objects/ConsecutiveFailureCounter'

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
            failsafeEmailId: 'fse_001' as never,
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
})
