import { describe, it, expect } from 'vitest'
import type { Allowlist, UserId } from '@warimaru/domain'
import { AllowlistSchema, InvariantViolationError } from '@warimaru/domain'
import { db } from './setup'
import { NeonAppUserRepository } from '../../src/onboarding-auth/NeonAppUserRepository'
import { NeonSpouseCompletionQuery } from '../../src/onboarding-auth/NeonSpouseCompletionQuery'
import { DARLING_USER_ID, HONEY_USER_ID } from '../helpers/fixtures'
import {
  operationStartedUser,
  phase2CompletedUser,
  phase2InProgressUser,
} from '../helpers/onboardingFixtures'

const repo = new NeonAppUserRepository(db)
const NOW = new Date('2026-07-07T00:00:00.000Z')
const allowlist: Allowlist = AllowlistSchema.parse({
  honeyLineUserId: HONEY_USER_ID,
  darlingLineUserId: DARLING_USER_ID,
})
const query = new NeonSpouseCompletionQuery(db, {
  fetchAllowlist: () => Promise.resolve(allowlist),
  now: () => NOW,
})

describe('NeonSpouseCompletionQuery', () => {
  it('両者 Phase2 完了なら both_completed（bothCompletedAt = 遅い方）', async () => {
    await repo.save(
      phase2CompletedUser({
        userId: HONEY_USER_ID,
        role: 'honey',
        phase2CompletedAt: new Date('2026-06-10T00:00:00.000Z'),
      }),
    )
    await repo.save(
      phase2CompletedUser({
        userId: DARLING_USER_ID,
        role: 'darling',
        phase2CompletedAt: new Date('2026-06-12T00:00:00.000Z'),
      }),
    )
    expect(await query.check(HONEY_USER_ID)).toEqual({
      kind: 'both_completed',
      honeyUserId: HONEY_USER_ID,
      darlingUserId: DARLING_USER_ID,
      bothCompletedAt: new Date('2026-06-12T00:00:00.000Z'),
    })
  })

  it('operation_started も「完了」に含まれる（darling 視点でも役割が正しく割り当たる）', async () => {
    await repo.save(operationStartedUser({ userId: HONEY_USER_ID, role: 'honey' }))
    await repo.save(phase2CompletedUser({ userId: DARLING_USER_ID, role: 'darling' }))
    const result = await query.check(DARLING_USER_ID)
    expect(result.kind).toBe('both_completed')
    if (result.kind === 'both_completed') {
      expect(result.honeyUserId).toBe(HONEY_USER_ID)
      expect(result.darlingUserId).toBe(DARLING_USER_ID)
    }
  })

  it('配偶者が Phase2 進行中なら awaiting_spouse', async () => {
    await repo.save(phase2CompletedUser({ userId: HONEY_USER_ID, role: 'honey' }))
    await repo.save(phase2InProgressUser({ userId: DARLING_USER_ID, role: 'darling' }))
    expect(await query.check(HONEY_USER_ID)).toEqual({
      kind: 'awaiting_spouse',
      userId: HONEY_USER_ID,
      spouseUserId: DARLING_USER_ID,
      detectedAt: NOW,
    })
  })

  it('配偶者行が未登録なら許可リストから spouseUserId を補う', async () => {
    await repo.save(phase2CompletedUser({ userId: HONEY_USER_ID, role: 'honey' }))
    expect(await query.check(HONEY_USER_ID)).toEqual({
      kind: 'awaiting_spouse',
      userId: HONEY_USER_ID,
      spouseUserId: DARLING_USER_ID,
      detectedAt: NOW,
    })
  })

  it('許可リスト外の viewer は InvariantViolationError', async () => {
    await expect(query.check('U-stranger' as UserId)).rejects.toThrow(InvariantViolationError)
  })
})
