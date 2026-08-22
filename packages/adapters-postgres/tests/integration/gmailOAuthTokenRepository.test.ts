import { describe, it, expect } from 'vitest'
import type { UserId, ValidGmailOAuthToken } from '@warimaru/domain'
import { detectTokenRevocation } from '@warimaru/domain'
import { db } from './setup'
import { PostgresGmailOAuthTokenRepository } from '../../src/onboarding-auth/PostgresGmailOAuthTokenRepository'
import { DARLING_USER_ID, HONEY_USER_ID } from '../helpers/fixtures'
import { revokedGmailToken, validGmailToken } from '../helpers/onboardingFixtures'

const repo = new PostgresGmailOAuthTokenRepository(db)

describe('PostgresGmailOAuthTokenRepository', () => {
  it('save → findByUserId の往復同一性（valid / revocation_detected 両変種）', async () => {
    const valid = validGmailToken({ userId: HONEY_USER_ID })
    const revoked = revokedGmailToken({ userId: DARLING_USER_ID })
    await repo.save(valid)
    await repo.save(revoked)
    expect(await repo.findByUserId(HONEY_USER_ID)).toEqual(valid)
    expect(await repo.findByUserId(DARLING_USER_ID)).toEqual(revoked)
  })

  it('未知のユーザーは null', async () => {
    expect(await repo.findByUserId('U-unknown' as UserId)).toBeNull()
  })

  it('失効検知の再 save で同一ユーザーの行が上書きされる（ユーザーごとに 1 件）', async () => {
    const valid = validGmailToken({ userId: HONEY_USER_ID }) as ValidGmailOAuthToken
    await repo.save(valid)
    const revoked = detectTokenRevocation(valid, 'expired', new Date('2026-07-06T00:00:00.000Z'))
    await repo.save(revoked)
    expect(await repo.findByUserId(HONEY_USER_ID)).toEqual(revoked)
  })
})
