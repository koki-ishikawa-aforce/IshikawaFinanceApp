import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import type { AccumulatingCycle, MonthlyExpenseCycleId } from '@warimaru/domain'
import { confirmCycleCsv, InvariantViolationError } from '@warimaru/domain'
import { db } from './setup'
import { PostgresMonthlyExpenseCycleRepository } from '../../src/expense-settlement/PostgresMonthlyExpenseCycleRepository'
import { newUlid } from '../../src/newId'
import { DARLING_USER_ID, HONEY_USER_ID, ym } from '../helpers/fixtures'
import { accumulatingCycle, finalizedCycle } from '../helpers/expenseSettlementFixtures'

const repo = new PostgresMonthlyExpenseCycleRepository(db)

describe('PostgresMonthlyExpenseCycleRepository', () => {
  it('save → findById の往復同一性（accumulating / csv_confirmed / finalized 全変種）', async () => {
    const accumulating = accumulatingCycle({ targetYearMonth: ym('2026-07') }) as AccumulatingCycle
    await repo.save(accumulating)
    expect(await repo.findById(accumulating.common.monthlyExpenseCycleId)).toEqual(accumulating)

    const csvConfirmed = confirmCycleCsv(accumulating, new Date('2026-08-01T01:00:00.000Z'))
    await repo.save(csvConfirmed)
    expect(await repo.findById(accumulating.common.monthlyExpenseCycleId)).toEqual(csvConfirmed)

    const finalized = finalizedCycle({ targetYearMonth: ym('2026-06') })
    await repo.save(finalized)
    expect(await repo.findById(finalized.common.monthlyExpenseCycleId)).toEqual(finalized)
  })

  it('未知の ID は null', async () => {
    expect(await repo.findById('01HZZZZZZZZZZZZZZZZZZZZZZZ' as MonthlyExpenseCycleId)).toBeNull()
  })

  it('findByUserAndMonth は該当 1 件（他ユーザー・他月は返さない）', async () => {
    const mine = accumulatingCycle({ userId: HONEY_USER_ID, targetYearMonth: ym('2026-07') })
    await repo.save(mine)
    await repo.save(accumulatingCycle({ userId: DARLING_USER_ID, targetYearMonth: ym('2026-07') }))
    expect(await repo.findByUserAndMonth(HONEY_USER_ID, ym('2026-07'))).toEqual(mine)
    expect(await repo.findByUserAndMonth(HONEY_USER_ID, ym('2026-06'))).toBeNull()
  })

  it('同一 (userId, month) の別 ID save は InvariantViolationError', async () => {
    await repo.save(accumulatingCycle({ userId: HONEY_USER_ID, targetYearMonth: ym('2026-07') }))
    await expect(
      repo.save(accumulatingCycle({ userId: HONEY_USER_ID, targetYearMonth: ym('2026-07') })),
    ).rejects.toThrow(InvariantViolationError)
  })

  it('DDL: 不正な kind / YYYY-MM 形式違反を拒否する（23514）', async () => {
    const insert = (month: string, kind: string): Promise<unknown> =>
      db.execute(
        sql`INSERT INTO monthly_expense_cycles
            (monthly_expense_cycle_id, user_id, target_year_month, kind, payload)
            VALUES (${newUlid()}, 'U-x', ${month}, ${kind}, '{}'::jsonb)`,
      )
    const code = async (p: Promise<unknown>): Promise<string | undefined> => {
      try {
        await p
        return undefined
      } catch (e) {
        const err = e as { code?: string; cause?: { code?: string } }
        return err.cause?.code ?? err.code
      }
    }
    expect(await code(insert('2026-13', 'accumulating'))).toBe('23514')
    expect(await code(insert('2026-07', 'bogus'))).toBe('23514')
  })
})
