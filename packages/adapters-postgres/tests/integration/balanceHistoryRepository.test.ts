import { describe, it, expect } from 'vitest'
import { PostgresBalanceHistoryRepository } from '../../src/balance-asset-tracking/PostgresBalanceHistoryRepository'
import { PostgresAccountRepository } from '../../src/balance-asset-tracking/PostgresAccountRepository'
import { db } from './setup'
import { balanceHistoryEntry, smbcAccount } from '../helpers/fixtures'

const accounts = new PostgresAccountRepository(db)
const repo = new PostgresBalanceHistoryRepository(db)

async function givenAccount(): Promise<string> {
  const account = smbcAccount()
  await accounts.save(account)
  return account.common.accountId
}

describe('PostgresBalanceHistoryRepository', () => {
  it('追記した変動を発生日時の昇順で読み出す（上端は未満）', async () => {
    const accountId = await givenAccount()
    await repo.append(
      balanceHistoryEntry({
        accountId,
        balance: 200,
        occurredAt: new Date('2026-05-20T00:00:00.000Z'),
      }),
    )
    await repo.append(
      balanceHistoryEntry({
        accountId,
        balance: 100,
        occurredAt: new Date('2026-05-10T00:00:00.000Z'),
      }),
    )
    // 上端ちょうど = 範囲外
    await repo.append(
      balanceHistoryEntry({
        accountId,
        balance: 300,
        occurredAt: new Date('2026-06-01T00:00:00.000Z'),
      }),
    )

    const found = await repo.findByOccurredAtRange(
      new Date('2026-05-01T00:00:00.000Z'),
      new Date('2026-06-01T00:00:00.000Z'),
    )
    expect(found.map(e => e.balance)).toEqual([100, 200])
  })

  it('同じ (軸, 由来イベントID) の再追記は無視する（イベント再配信で点が重ならない）', async () => {
    const accountId = await givenAccount()
    const first = balanceHistoryEntry({
      accountId,
      balance: 100,
      occurredAt: new Date('2026-05-10T00:00:00.000Z'),
      sourceEventId: 'evt-same',
    })
    await repo.append(first)
    // 履歴エントリIDは記録のたびに採番されるため、再配信でも主キーは衝突しない
    await repo.append(
      balanceHistoryEntry({
        accountId,
        balance: 100,
        occurredAt: new Date('2026-05-10T00:00:00.000Z'),
        sourceEventId: 'evt-same',
      }),
    )

    const found = await repo.findByOccurredAtRange(
      new Date('2026-05-01T00:00:00.000Z'),
      new Date('2026-06-01T00:00:00.000Z'),
    )
    expect(found).toHaveLength(1)
    expect(found[0]?.entryId).toBe(first.entryId)
  })

  it('由来イベントIDが同じでも軸が違えば別の変動として残す', async () => {
    const accountId = await givenAccount()
    await repo.append(
      balanceHistoryEntry({ accountId, axis: 'smbc_balance', sourceEventId: 'evt-shared' }),
    )
    await repo.append(
      balanceHistoryEntry({ accountId, axis: 'card_unpaid', sourceEventId: 'evt-shared' }),
    )

    const found = await repo.findByOccurredAtRange(
      new Date('2026-05-01T00:00:00.000Z'),
      new Date('2026-06-01T00:00:00.000Z'),
    )
    expect(found.map(e => e.axis).sort()).toEqual(['card_unpaid', 'smbc_balance'])
  })

  it('findLatestBefore は指定軸の直前の値を返す（他の軸は混ざらない）', async () => {
    const accountId = await givenAccount()
    await repo.append(
      balanceHistoryEntry({
        accountId,
        axis: 'nisa_contribution',
        balance: 300000,
        occurredAt: new Date('2026-03-10T00:00:00.000Z'),
      }),
    )
    await repo.append(
      balanceHistoryEntry({
        accountId,
        axis: 'nisa_contribution',
        balance: 400000,
        occurredAt: new Date('2026-04-10T00:00:00.000Z'),
      }),
    )
    await repo.append(
      balanceHistoryEntry({
        accountId,
        axis: 'smbc_balance',
        balance: 999,
        occurredAt: new Date('2026-04-20T00:00:00.000Z'),
      }),
    )

    const latest = await repo.findLatestBefore(
      'nisa_contribution',
      new Date('2026-05-01T00:00:00.000Z'),
    )
    expect(latest?.balance).toBe(400000)
  })

  it('findLatestBefore は該当が無ければ null（0 で埋めない）', async () => {
    const accountId = await givenAccount()
    await repo.append(
      balanceHistoryEntry({
        accountId,
        axis: 'nisa_contribution',
        occurredAt: new Date('2026-06-10T00:00:00.000Z'),
      }),
    )

    const latest = await repo.findLatestBefore(
      'nisa_contribution',
      new Date('2026-05-01T00:00:00.000Z'),
    )
    expect(latest).toBeNull()
  })
})
