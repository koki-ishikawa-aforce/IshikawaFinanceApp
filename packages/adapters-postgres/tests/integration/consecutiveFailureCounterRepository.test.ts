import { describe, it, expect } from 'vitest'
import { db } from './setup'
import { PostgresConsecutiveFailureCounterRepository } from '../../src/notification-delivery/PostgresConsecutiveFailureCounterRepository'
import { DARLING_USER_ID } from '../helpers/fixtures'
import {
  failingCounter,
  talkRoomCounterRef,
  userCounterRef,
  zeroCounter,
} from '../helpers/notificationFixtures'

const repo = new PostgresConsecutiveFailureCounterRepository(db)

describe('PostgresConsecutiveFailureCounterRepository（複合 PK ref_kind + ref_id）', () => {
  it('save → findByRef の往復同一性（user / talk_room 両参照）', async () => {
    const userCounter = zeroCounter(userCounterRef())
    const roomCounter = failingCounter(talkRoomCounterRef())
    await repo.save(userCounter)
    await repo.save(roomCounter)
    expect(await repo.findByRef(userCounterRef())).toEqual(userCounter)
    expect(await repo.findByRef(talkRoomCounterRef())).toEqual(roomCounter)
  })

  it('未登録の参照は null', async () => {
    expect(await repo.findByRef(userCounterRef(DARLING_USER_ID))).toBeNull()
  })

  it('カウンタは可変: 同一参照の再 save で上書きされる（増加 → リセット）', async () => {
    const ref = userCounterRef()
    await repo.save(failingCounter(ref, 2))
    const reset = zeroCounter(ref)
    await repo.save(reset)
    expect(await repo.findByRef(ref)).toEqual(reset)
  })
})
