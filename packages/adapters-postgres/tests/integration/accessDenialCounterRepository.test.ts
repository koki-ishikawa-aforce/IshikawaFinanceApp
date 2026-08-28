import { describe, it, expect } from 'vitest'
import { db } from './setup'
import { PostgresAccessDenialCounterRepository } from '../../src/onboarding-auth/PostgresAccessDenialCounterRepository'
import { HONEY_USER_ID, DARLING_USER_ID } from '../helpers/fixtures'

const repo = new PostgresAccessDenialCounterRepository(db)

describe('PostgresAccessDenialCounterRepository（LINE_userID ごとに 1 行、#651）', () => {
  it('save → findByLineUserId の往復同一性', async () => {
    const at = new Date('2026-08-28T10:00:00Z')
    const counter = { lineUserId: HONEY_USER_ID, deniedCount: 1, lastDeniedAt: at }
    await repo.save(counter)
    expect(await repo.findByLineUserId(HONEY_USER_ID)).toEqual(counter)
  })

  it('未登録の LINE_userID は null', async () => {
    expect(await repo.findByLineUserId(DARLING_USER_ID)).toBeNull()
  })

  it('カウンタは可変: 同一 LINE_userID の再 save で上書きされる（累計回数が増える）', async () => {
    const first = new Date('2026-08-28T10:00:00Z')
    const second = new Date('2026-08-28T10:05:00Z')
    await repo.save({ lineUserId: HONEY_USER_ID, deniedCount: 1, lastDeniedAt: first })
    const updated = { lineUserId: HONEY_USER_ID, deniedCount: 2, lastDeniedAt: second }
    await repo.save(updated)
    expect(await repo.findByLineUserId(HONEY_USER_ID)).toEqual(updated)
  })

  it('別の LINE_userID の記録には影響しない（否定形）', async () => {
    await repo.save({ lineUserId: HONEY_USER_ID, deniedCount: 3, lastDeniedAt: new Date() })
    expect(await repo.findByLineUserId(DARLING_USER_ID)).toBeNull()
  })
})
