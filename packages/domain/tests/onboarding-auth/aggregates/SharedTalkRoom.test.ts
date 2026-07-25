import { describe, it, expect } from 'vitest'
import {
  NOT_JOINED_SHARED_TALK_ROOM,
  SharedTalkRoomSchema,
  joinedTalkRoomIdOf,
  recordSharedTalkRoomJoined,
} from '../../../src/onboarding-auth/aggregates/SharedTalkRoom'

describe('共通トークルーム（世帯レベル、OQ-55 ①）', () => {
  it('未参加からの参加記録で参加済みへ遷移する', () => {
    const at = new Date('2026-07-01T00:00:00Z')
    const joined = recordSharedTalkRoomJoined(NOT_JOINED_SHARED_TALK_ROOM, 'room_001' as never, at)
    expect(joined).toEqual({
      kind: 'joined',
      talkRoomId: 'room_001',
      joinWebhookReceivedAt: at,
    })
  })

  it('同一トークルームの再記録は冪等（受信日時を上書きしない）', () => {
    const first = new Date('2026-07-01T00:00:00Z')
    const joined = recordSharedTalkRoomJoined(
      NOT_JOINED_SHARED_TALK_ROOM,
      'room_001' as never,
      first,
    )
    const again = recordSharedTalkRoomJoined(
      joined,
      'room_001' as never,
      new Date('2026-07-02T00:00:00Z'),
    )
    expect(again).toBe(joined)
  })

  it('別トークルームでの参加は最新の記録で置き換える（招待し直し）', () => {
    const first = new Date('2026-07-01T00:00:00Z')
    const second = new Date('2026-07-05T00:00:00Z')
    const joined = recordSharedTalkRoomJoined(
      NOT_JOINED_SHARED_TALK_ROOM,
      'room_001' as never,
      first,
    )
    const rejoined = recordSharedTalkRoomJoined(joined, 'room_002' as never, second)
    expect(rejoined).toEqual({
      kind: 'joined',
      talkRoomId: 'room_002',
      joinWebhookReceivedAt: second,
    })
  })

  it('joinedTalkRoomIdOf は未参加なら undefined を返す', () => {
    expect(joinedTalkRoomIdOf(NOT_JOINED_SHARED_TALK_ROOM)).toBeUndefined()
    const joined = recordSharedTalkRoomJoined(
      NOT_JOINED_SHARED_TALK_ROOM,
      'room_001' as never,
      new Date(),
    )
    expect(joinedTalkRoomIdOf(joined)).toBe('room_001')
  })

  it('参加済みはトークルームIDと受信日時を必須とする', () => {
    expect(() => SharedTalkRoomSchema.parse({ kind: 'joined' })).toThrow()
    expect(() => SharedTalkRoomSchema.parse({ kind: 'joined', talkRoomId: 'room_001' })).toThrow()
  })
})
