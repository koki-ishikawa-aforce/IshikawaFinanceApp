import { describe, it, expect } from 'vitest'
import type { ExpenseTypeId } from '@warimaru/domain'
import { InvariantViolationError } from '@warimaru/domain'
import { db } from './setup'
import { PostgresExpenseTypeMasterRepository } from '../../src/master-data/PostgresExpenseTypeMasterRepository'
import { DARLING_USER_ID, HONEY_USER_ID } from '../helpers/fixtures'
import { customExpenseType, defaultExpenseType } from '../helpers/masterDataFixtures'

const repo = new PostgresExpenseTypeMasterRepository(db)

describe('PostgresExpenseTypeMasterRepository', () => {
  it('save → findById の往復同一性（default / custom 両変種）', async () => {
    const def = defaultExpenseType()
    const custom = customExpenseType()
    await repo.save(def)
    await repo.save(custom)
    expect(await repo.findById(def.expenseTypeId)).toEqual(def)
    expect(await repo.findById(custom.expenseTypeId)).toEqual(custom)
  })

  it('未知の ID は null', async () => {
    expect(await repo.findById('01HZZZZZZZZZZZZZZZZZZZZZZZ' as ExpenseTypeId)).toBeNull()
  })

  it('findAllVisibleToUser は世帯共有 + 本人の個人別のみ返す', async () => {
    const shared = defaultExpenseType({ name: 'ジム' })
    const mine = customExpenseType({ name: 'セミナー', userId: HONEY_USER_ID })
    const spouses = customExpenseType({ name: '資格試験', userId: DARLING_USER_ID })
    await repo.save(shared)
    await repo.save(mine)
    await repo.save(spouses)

    const visible = await repo.findAllVisibleToUser(HONEY_USER_ID)
    const ids = visible.map(e => e.expenseTypeId)
    expect(ids).toContain(shared.expenseTypeId)
    expect(ids).toContain(mine.expenseTypeId)
    expect(ids).not.toContain(spouses.expenseTypeId)
  })

  it('同一スコープの名前重複は InvariantViolationError（owner NULL 同士も拒否）', async () => {
    await repo.save(defaultExpenseType({ name: 'ジム' }))
    await expect(repo.save(defaultExpenseType({ name: 'ジム' }))).rejects.toThrow(
      InvariantViolationError,
    )
    await repo.save(customExpenseType({ name: 'セミナー', userId: HONEY_USER_ID }))
    await expect(
      repo.save(customExpenseType({ name: 'セミナー', userId: HONEY_USER_ID })),
    ).rejects.toThrow(InvariantViolationError)
  })
})
