import { describe, it, expect } from 'vitest'
import { LineOperationSettingsSchema } from '../../../src/onboarding-auth/value-objects/LineOperationSettings'

const activated = {
  kind: 'activated',
  talkRoomId: 'room_001' as never,
  activatedAt: new Date(),
}

describe('LineOperationSettings 値オブジェクト', () => {
  it('友達追加 + 有効化の整合状態は parse 成功', () => {
    expect(() =>
      LineOperationSettingsSchema.parse({
        friendAdd: { kind: 'added', followWebhookReceivedAt: new Date() },
        notificationActivation: activated,
      }),
    ).not.toThrow()
  })

  it('通知有効化済みなのに友達未追加なら parse 失敗', () => {
    expect(() =>
      LineOperationSettingsSchema.parse({
        friendAdd: { kind: 'not_added' },
        notificationActivation: activated,
      }),
    ).toThrow()
  })

  it('全て未着手の初期状態は parse 成功', () => {
    expect(() =>
      LineOperationSettingsSchema.parse({
        friendAdd: { kind: 'not_added' },
        notificationActivation: { kind: 'not_activated' },
      }),
    ).not.toThrow()
  })

  it('移行前に保存された talkRoomJoin を含む記録は読取り時に無視される（OQ-55 ①）', () => {
    const parsed = LineOperationSettingsSchema.parse({
      friendAdd: { kind: 'added', followWebhookReceivedAt: new Date() },
      talkRoomJoin: {
        kind: 'joined',
        talkRoomId: 'room_001',
        joinWebhookReceivedAt: new Date(),
      },
      notificationActivation: activated,
    })
    expect(parsed).not.toHaveProperty('talkRoomJoin')
  })
})
