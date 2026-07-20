import { describe, it, expect } from 'vitest'
import type { UserId } from '@warimaru/domain'
import { InvariantViolationError, NotFoundError } from '@warimaru/domain'
import { db } from './setup'
import { NeonAppUserRepository } from '../../src/onboarding-auth/NeonAppUserRepository'
import { createDbResolveViewerRole } from '../../src/onboarding-auth/resolveViewerRole'
import { DARLING_USER_ID, HONEY_USER_ID } from '../helpers/fixtures'
import {
  operationStartedUser,
  phase1User,
  phase2CompletedUser,
  phase2InProgressUser,
} from '../helpers/onboardingFixtures'

const repo = new NeonAppUserRepository(db)

describe('NeonAppUserRepository', () => {
  it('save → findById の往復同一性（全 4 kind 変種）', async () => {
    const users = [
      phase1User({ userId: HONEY_USER_ID, role: 'honey' }),
      phase2InProgressUser({ userId: DARLING_USER_ID, role: 'darling' }),
    ]
    for (const user of users) {
      await repo.save(user)
      expect(await repo.findById(user.common.userId)).toEqual(user)
    }
    // 同一ユーザーの Phase 前進遷移（upsert 上書き）で残り 2 変種を検証
    const completed = phase2CompletedUser({ userId: HONEY_USER_ID, role: 'honey' })
    await repo.save(completed)
    expect(await repo.findById(HONEY_USER_ID)).toEqual(completed)
    const operating = operationStartedUser({ userId: HONEY_USER_ID, role: 'honey' })
    await repo.save(operating)
    expect(await repo.findById(HONEY_USER_ID)).toEqual(operating)
  })

  it('未知の ID は null', async () => {
    expect(await repo.findById('U-unknown' as UserId)).toBeNull()
  })

  it('findByRole は該当 1 名を返す（不在は null）', async () => {
    const honey = phase1User({ userId: HONEY_USER_ID, role: 'honey' })
    await repo.save(honey)
    expect(await repo.findByRole('honey')).toEqual(honey)
    expect(await repo.findByRole('darling')).toBeNull()
  })

  it('同一 role の別ユーザー save は InvariantViolationError（Honey/Darling 各 1 名）', async () => {
    await repo.save(phase1User({ userId: HONEY_USER_ID, role: 'honey' }))
    await expect(
      repo.save(phase1User({ userId: 'U-imposter' as UserId, role: 'honey' })),
    ).rejects.toThrow(InvariantViolationError)
  })
})

describe('createDbResolveViewerRole（第1波 queryDeps スタブの実 DB 差し替え）', () => {
  const resolve = createDbResolveViewerRole(db)

  it('登録済みユーザーの役割を返す', async () => {
    await repo.save(phase1User({ userId: DARLING_USER_ID, role: 'darling' }))
    expect(await resolve(DARLING_USER_ID)).toBe('darling')
  })

  it('未登録の viewer は NotFoundError', async () => {
    await expect(resolve('U-unknown' as UserId)).rejects.toThrow(NotFoundError)
  })
})
