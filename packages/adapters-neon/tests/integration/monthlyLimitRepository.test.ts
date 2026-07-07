import { describe, it, expect } from 'vitest'
import type { ExpenseTypeId, MonthlyLimitId, UnlimitedMonthlyLimit } from '@warimaru/domain'
import { InvariantViolationError, MonthlyLimitSchema } from '@warimaru/domain'
import { db } from './setup'
import { NeonMonthlyLimitRepository } from '../../src/master-data/NeonMonthlyLimitRepository'
import { newUlid } from '../../src/newId'
import { DARLING_USER_ID, HONEY_USER_ID } from '../helpers/fixtures'
import { cappedLimit, unlimitedLimit } from '../helpers/masterDataFixtures'

const repo = new NeonMonthlyLimitRepository(db)

describe('NeonMonthlyLimitRepository', () => {
  it('save → findById の往復同一性（capped / unlimited 両変種）', async () => {
    const capped = cappedLimit()
    const unlimited = unlimitedLimit()
    await repo.save(capped)
    await repo.save(unlimited)
    expect(await repo.findById(capped.monthlyLimitId)).toEqual(capped)
    expect(await repo.findById(unlimited.monthlyLimitId)).toEqual(unlimited)
  })

  it('未知の ID は null', async () => {
    expect(await repo.findById('01HZZZZZZZZZZZZZZZZZZZZZZZ' as MonthlyLimitId)).toBeNull()
  })

  it('findByUserAndExpenseType は該当 1 件を返す（該当なしは null）', async () => {
    const expenseTypeId = newUlid() as ExpenseTypeId
    const limit = cappedLimit({ userId: HONEY_USER_ID, expenseTypeId })
    await repo.save(limit)
    expect(await repo.findByUserAndExpenseType(HONEY_USER_ID, expenseTypeId)).toEqual(limit)
    expect(await repo.findByUserAndExpenseType(DARLING_USER_ID, expenseTypeId)).toBeNull()
  })

  it('同一 (userId, expenseTypeId) の別 ID save は InvariantViolationError', async () => {
    const expenseTypeId = newUlid() as ExpenseTypeId
    await repo.save(cappedLimit({ userId: HONEY_USER_ID, expenseTypeId }))
    await expect(
      repo.save(unlimitedLimit({ userId: HONEY_USER_ID, expenseTypeId })),
    ).rejects.toThrow(InvariantViolationError)
  })

  it('同一 ID の再 save は capped → unlimited へ遷移できる（cap_amount が NULL に戻る）', async () => {
    const capped = cappedLimit()
    await repo.save(capped)
    const unlimited: UnlimitedMonthlyLimit = MonthlyLimitSchema.parse({
      kind: 'unlimited',
      monthlyLimitId: capped.monthlyLimitId,
      userId: capped.userId,
      expenseTypeId: capped.expenseTypeId,
      effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
    }) as UnlimitedMonthlyLimit
    await repo.save(unlimited)
    expect(await repo.findById(capped.monthlyLimitId)).toEqual(unlimited)
  })
})
