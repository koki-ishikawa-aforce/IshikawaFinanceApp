import { describe, it, expect } from 'vitest'
import { LineOperationSettingsSchema } from '../../../src/onboarding-auth/value-objects/LineOperationSettings'

const joined = {
  kind: 'joined',
  talkRoomId: 'room_001' as never,
  joinWebhookReceivedAt: new Date(),
}
const activated = {
  kind: 'activated',
  talkRoomId: 'room_001' as never,
  activatedAt: new Date(),
}

describe('LineOperationSettings 値オブジェクト', () => {
  it('友達追加 + 参加 + 有効化の整合状態は parse 成功', () => {
    expect(() =>
      LineOperationSettingsSchema.parse({
        friendAdd: { kind: 'added', followWebhookReceivedAt: new Date() },
        talkRoomJoin: joined,
        notificationActivation: activated,
      }),
    ).not.toThrow()
  })

  it('通知有効化済みなのにトークルーム未参加なら parse 失敗', () => {
    expect(() =>
      LineOperationSettingsSchema.parse({
        friendAdd: { kind: 'added', followWebhookReceivedAt: new Date() },
        talkRoomJoin: { kind: 'not_joined' },
        notificationActivation: activated,
      }),
    ).toThrow()
  })

  it('通知有効化済みなのに友達未追加なら parse 失敗', () => {
    expect(() =>
      LineOperationSettingsSchema.parse({
        friendAdd: { kind: 'not_added' },
        talkRoomJoin: joined,
        notificationActivation: activated,
      }),
    ).toThrow()
  })

  it('通知有効化のトークルームIDが参加済みトークルームIDと不一致なら parse 失敗', () => {
    expect(() =>
      LineOperationSettingsSchema.parse({
        friendAdd: { kind: 'added', followWebhookReceivedAt: new Date() },
        talkRoomJoin: joined,
        notificationActivation: { ...activated, talkRoomId: 'room_002' as never },
      }),
    ).toThrow()
  })

  it('全て未着手の初期状態は parse 成功', () => {
    expect(() =>
      LineOperationSettingsSchema.parse({
        friendAdd: { kind: 'not_added' },
        talkRoomJoin: { kind: 'not_joined' },
        notificationActivation: { kind: 'not_activated' },
      }),
    ).not.toThrow()
  })
})
