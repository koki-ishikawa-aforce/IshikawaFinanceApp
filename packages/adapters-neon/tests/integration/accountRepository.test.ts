import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { InvariantViolationError } from '@warimaru/domain'
import { NeonAccountRepository } from '../../src/balance-asset-tracking/NeonAccountRepository'
import { createTestDb, resetDb } from '../helpers/db'
import {
  HONEY_USER_ID,
  DARLING_USER_ID,
  cardAccount,
  nisaAccount,
  otherSavingsAccount,
  smbcAccount,
} from '../helpers/fixtures'

const { db, close } = createTestDb()
const repo = new NeonAccountRepository(db)

beforeEach(() => resetDb(db))
afterAll(() => close())

describe('NeonAccountRepository', () => {
  it('save → findById の往復で 4 kind（inactive 含む）が同一に復元される', async () => {
    const variants = [
      smbcAccount(),
      cardAccount(),
      otherSavingsAccount(),
      nisaAccount({ ownerUserId: DARLING_USER_ID }),
      smbcAccount({ ownerUserId: DARLING_USER_ID, isActive: false }),
    ]
    for (const account of variants) {
      await repo.save(account)
      expect(await repo.findById(account.common.accountId)).toEqual(account)
    }
  })

  it('findByOwner は所有者の口座だけを返す', async () => {
    const honeySmbc = smbcAccount({ ownerUserId: HONEY_USER_ID })
    const honeyNisa = nisaAccount({ ownerUserId: HONEY_USER_ID })
    const darlingSmbc = smbcAccount({ ownerUserId: DARLING_USER_ID })
    for (const account of [honeySmbc, honeyNisa, darlingSmbc]) {
      await repo.save(account)
    }
    const found = await repo.findByOwner(HONEY_USER_ID)
    expect(found.map(a => a.common.accountId).sort()).toEqual(
      [honeySmbc.common.accountId, honeyNisa.common.accountId].sort(),
    )
  })

  it('同一ユーザー × 口座種別の重複 save は InvariantViolationError（Phase 4 §6.3 保留分）', async () => {
    await repo.save(smbcAccount({ ownerUserId: HONEY_USER_ID }))
    await expect(repo.save(smbcAccount({ ownerUserId: HONEY_USER_ID }))).rejects.toThrow(
      InvariantViolationError,
    )
    // 別ユーザーの同種別は許容される
    await expect(repo.save(smbcAccount({ ownerUserId: DARLING_USER_ID }))).resolves.toBeUndefined()
  })

  it('save は upsert（残高更新が反映される）', async () => {
    const account = smbcAccount({ currentBalance: 1500000 })
    await repo.save(account)
    if (account.kind !== 'smbc_bank') throw new Error('unreachable')
    const updated = {
      ...account,
      balance: {
        ...account.balance,
        currentBalance: 1600000 as typeof account.balance.currentBalance,
      },
    }
    await repo.save(updated)
    const found = await repo.findById(account.common.accountId)
    if (found?.kind !== 'smbc_bank') throw new Error('unreachable')
    expect(found.balance.currentBalance).toBe(1600000)
  })
})
