import { describe, it, expect } from 'vitest'
import type { TalkRoomId } from '@warimaru/domain'
import { NOT_JOINED_SHARED_TALK_ROOM, recordSharedTalkRoomJoined } from '@warimaru/domain'
import { db } from './setup'
import { NeonSharedTalkRoomRepository } from '../../src/onboarding-auth/NeonSharedTalkRoomRepository'
import { sharedTalkRooms } from '../../src/schema'

const repo = new NeonSharedTalkRoomRepository(db)

const ROOM_A = 'C0000000000000000000000000000001' as TalkRoomId
const ROOM_B = 'C0000000000000000000000000000002' as TalkRoomId

describe('NeonSharedTalkRoomRepository', () => {
  it('記録が無ければ未参加を返す', async () => {
    expect(await repo.find()).toEqual(NOT_JOINED_SHARED_TALK_ROOM)
  })

  it('save → find の往復同一性（参加済み）', async () => {
    const joined = recordSharedTalkRoomJoined(
      NOT_JOINED_SHARED_TALK_ROOM,
      ROOM_A,
      new Date('2026-07-01T00:00:00.000Z'),
    )
    await repo.save(joined)
    expect(await repo.find()).toEqual(joined)
  })

  it('別トークルームの save で行が置き換わる（世帯で 1 件）', async () => {
    await repo.save(
      recordSharedTalkRoomJoined(
        NOT_JOINED_SHARED_TALK_ROOM,
        ROOM_A,
        new Date('2026-07-01T00:00:00.000Z'),
      ),
    )
    const rejoined = recordSharedTalkRoomJoined(
      NOT_JOINED_SHARED_TALK_ROOM,
      ROOM_B,
      new Date('2026-07-05T00:00:00.000Z'),
    )
    await repo.save(rejoined)

    expect(await repo.find()).toEqual(rejoined)
    const rows = await db.select().from(sharedTalkRooms)
    expect(rows).toHaveLength(1)
  })

  it('同一トークルームの再 save は冪等（受信日時を保つ）', async () => {
    const joined = recordSharedTalkRoomJoined(
      NOT_JOINED_SHARED_TALK_ROOM,
      ROOM_A,
      new Date('2026-07-01T00:00:00.000Z'),
    )
    await repo.save(joined)
    await repo.save(
      recordSharedTalkRoomJoined(joined, ROOM_A, new Date('2026-07-09T00:00:00.000Z')),
    )
    expect(await repo.find()).toEqual(joined)
  })
})
