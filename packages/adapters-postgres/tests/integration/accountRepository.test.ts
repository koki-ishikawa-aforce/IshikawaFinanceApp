import { describe, it, expect } from 'vitest'
import {
  AccountIdSchema,
  ConcurrentUpdateError,
  InvariantViolationError,
  SettlementNoticeIdSchema,
  applyUnpaidSettlementToSmbcBalance,
  correctOtherSavingsBalance,
  money,
  withdrawOtherSavings,
  type OtherSavingsAccount,
} from '@warimaru/domain'
import { PostgresAccountRepository } from '../../src/balance-asset-tracking/PostgresAccountRepository'
import { accounts } from '../../src/schema'
import { newUlid } from '../../src/newId'
import { db } from './setup'
import {
  HONEY_USER_ID,
  DARLING_USER_ID,
  cardAccount,
  nisaAccount,
  otherSavingsAccount,
  smbcAccount,
} from '../helpers/fixtures'

const repo = new PostgresAccountRepository(db)

describe('PostgresAccountRepository', () => {
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

  // --- #388: 引落確定通知IDの記録（既存行との後方互換） ---

  it('この項目を持たない既存行も読み出せ、未反映（null）として復元される', async () => {
    // 本番に既に存在する payload の形（appliedSettlementNoticeIds が無い）を直接 INSERT する。
    // 集約経由で作ると新項目が必ず入ってしまい、既存行の読み出しを検証できない。
    const accountId = newUlid()
    const legacyPayload = {
      kind: 'smbc_bank',
      common: {
        accountId,
        ownerUserId: HONEY_USER_ID,
        registeredAt: '2026-01-01T00:00:00.000Z',
        activeness: { kind: 'active' },
      },
      balance: {
        currentBalance: 1500000,
        initialBalance: 1000000,
        initialBalanceBaselineAt: '2026-01-01T00:00:00.000Z',
        lastUpdatedAt: '2026-07-01T00:00:00.000Z',
      },
    }
    await db.insert(accounts).values({
      accountId,
      ownerUserId: HONEY_USER_ID,
      kind: 'smbc_bank',
      isActive: true,
      payload: legacyPayload,
    })

    const found = await repo.findById(AccountIdSchema.parse(accountId))
    if (found?.kind !== 'smbc_bank') throw new Error('unreachable')
    expect(found.balance.appliedSettlementNoticeIds).toEqual([])

    // 既存行に対して消込を反映して保存し直せる（読み書きの両方が成立する）
    const applied = applyUnpaidSettlementToSmbcBalance(found, {
      settlementNoticeId: SettlementNoticeIdSchema.parse('sn-2026-07-25-legacy'),
      settledTotal: money(8000),
      at: new Date('2026-07-25T00:00:00.000Z'),
    })
    await repo.save(applied)

    const reloaded = await repo.findById(AccountIdSchema.parse(accountId))
    if (reloaded?.kind !== 'smbc_bank') throw new Error('unreachable')
    expect(reloaded.balance.currentBalance).toBe(1492000)
    expect(reloaded.balance.appliedSettlementNoticeIds).toEqual(['sn-2026-07-25-legacy'])
  })

  it('引落確定通知IDが payload に永続化され、往復で保たれる', async () => {
    const account = smbcAccount()
    if (account.kind !== 'smbc_bank') throw new Error('unreachable')
    const applied = applyUnpaidSettlementToSmbcBalance(account, {
      settlementNoticeId: SettlementNoticeIdSchema.parse('sn-2026-07-25-roundtrip'),
      settledTotal: money(3000),
      at: new Date('2026-07-25T00:00:00.000Z'),
    })
    await repo.save(applied)

    expect(await repo.findById(applied.common.accountId)).toEqual(applied)
  })

  // --- #459: 手入力の操作記録と版数照合（楽観ロック） ---

  it('手入力の操作記録が payload に永続化され、往復で保たれる', async () => {
    const account = otherSavingsAccount({ currentBalance: 800000 }) as OtherSavingsAccount
    await repo.save(account)
    const stored = (await repo.findById(account.common.accountId)) as OtherSavingsAccount
    const withdrawn = withdrawOtherSavings(stored, {
      amount: money(120000),
      operatorUserId: DARLING_USER_ID,
      at: new Date('2026-07-25T00:00:00.000Z'),
      memo: '旅行費',
    })
    await repo.save(withdrawn)

    const reloaded = (await repo.findById(account.common.accountId)) as OtherSavingsAccount
    expect(reloaded.balance.currentBalance).toBe(680000)
    expect(reloaded.balance.manualEntries).toEqual([
      {
        kind: 'manual_withdrawal',
        enteredByUserId: DARLING_USER_ID,
        amount: 120000,
        enteredAt: new Date('2026-07-25T00:00:00.000Z'),
        memo: '旅行費',
      },
    ])
  })

  it('版数は保存のたびに 1 進む（既存行への上書き）', async () => {
    const account = otherSavingsAccount({ currentBalance: 800000 }) as OtherSavingsAccount
    await repo.save(account)
    // 新規 insert 後は版数 0
    const v0 = await repo.findById(account.common.accountId)
    expect(v0?.common.version).toBe(0)
    // 1 回更新すると版数 1
    const corrected = correctOtherSavingsBalance(v0 as OtherSavingsAccount, {
      correctedBalance: money(750000),
      operatorUserId: DARLING_USER_ID,
      at: new Date('2026-07-25T00:00:00.000Z'),
    })
    await repo.save(corrected)
    const v1 = await repo.findById(account.common.accountId)
    expect(v1?.common.version).toBe(1)
  })

  it('古い版で保存し直すと ConcurrentUpdateError（同時更新の後勝ちを防ぐ）', async () => {
    const account = otherSavingsAccount({ currentBalance: 800000 }) as OtherSavingsAccount
    await repo.save(account)

    // 2 つのセッションが同じ版（0）を読み出す
    const readA = (await repo.findById(account.common.accountId)) as OtherSavingsAccount
    const readB = (await repo.findById(account.common.accountId)) as OtherSavingsAccount
    expect(readA.common.version).toBe(0)
    expect(readB.common.version).toBe(0)

    // A が先に取り崩しを保存 → 版数 1 へ
    const a = withdrawOtherSavings(readA, {
      amount: money(100000),
      operatorUserId: DARLING_USER_ID,
      at: new Date('2026-07-25T00:00:00.000Z'),
    })
    await repo.save(a)

    // B は読んだときの版（0）のまま保存しようとする → 拒否（A の更新を消さない）
    const b = withdrawOtherSavings(readB, {
      amount: money(50000),
      operatorUserId: DARLING_USER_ID,
      at: new Date('2026-07-25T01:00:00.000Z'),
    })
    await expect(repo.save(b)).rejects.toThrow(ConcurrentUpdateError)

    // A の更新だけが残る（B は上書きしていない）
    const reloaded = (await repo.findById(account.common.accountId)) as OtherSavingsAccount
    expect(reloaded.balance.currentBalance).toBe(700000)
    expect(reloaded.balance.manualEntries).toHaveLength(1)
    expect(reloaded.common.version).toBe(1)

    // B は最新版を読み直せばやり直せる（一時的な競合であることの確認）
    const retry = withdrawOtherSavings(reloaded, {
      amount: money(50000),
      operatorUserId: DARLING_USER_ID,
      at: new Date('2026-07-25T02:00:00.000Z'),
    })
    await repo.save(retry)
    const final = (await repo.findById(account.common.accountId)) as OtherSavingsAccount
    expect(final.balance.currentBalance).toBe(650000)
    expect(final.common.version).toBe(2)
  })

  it('この項目を持たない既存行は版数 0・空の操作記録として読み出せる（後方互換）', async () => {
    // version 列・manualEntries を持たない既存 payload を直接 INSERT する
    const accountId = newUlid()
    const legacyPayload = {
      kind: 'other_savings',
      common: {
        accountId,
        ownerUserId: DARLING_USER_ID,
        registeredAt: '2026-01-03T00:00:00.000Z',
        activeness: { kind: 'active' },
      },
      bankName: 'ゆうちょ銀行',
      balance: {
        currentBalance: 800000,
        initialBalance: 500000,
        initialBalanceBaselineAt: '2026-01-03T00:00:00.000Z',
        lastUpdatedAt: '2026-07-01T00:00:00.000Z',
      },
      freshnessSource: { lastUpdatedAt: '2026-07-01T00:00:00.000Z' },
    }
    // version 列は DEFAULT 0 で埋まる
    await db.insert(accounts).values({
      accountId,
      ownerUserId: DARLING_USER_ID,
      kind: 'other_savings',
      isActive: true,
      payload: legacyPayload,
    })

    const found = (await repo.findById(
      AccountIdSchema.parse(accountId),
    )) as OtherSavingsAccount | null
    if (found?.kind !== 'other_savings') throw new Error('unreachable')
    expect(found.common.version).toBe(0)
    expect(found.balance.manualEntries).toEqual([])

    // 既存行に対して手入力を積んで保存し直せる（読み書きの両方が成立する）
    const withdrawn = withdrawOtherSavings(found, {
      amount: money(100000),
      operatorUserId: DARLING_USER_ID,
      at: new Date('2026-07-25T00:00:00.000Z'),
    })
    await repo.save(withdrawn)
    const reloaded = (await repo.findById(AccountIdSchema.parse(accountId))) as OtherSavingsAccount
    expect(reloaded.balance.currentBalance).toBe(700000)
    expect(reloaded.balance.manualEntries).toHaveLength(1)
    expect(reloaded.common.version).toBe(1)
  })
})
