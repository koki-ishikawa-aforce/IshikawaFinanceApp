import { describe, it, expect } from 'vitest'
import { PostgresBalanceHistoryRepository } from '../../src/balance-asset-tracking/PostgresBalanceHistoryRepository'
import { PostgresAccountRepository } from '../../src/balance-asset-tracking/PostgresAccountRepository'
import { db } from './setup'
import {
  DARLING_USER_ID,
  HONEY_USER_ID,
  balanceHistoryEntry,
  smbcAccount,
} from '../helpers/fixtures'

const accounts = new PostgresAccountRepository(db)
const repo = new PostgresBalanceHistoryRepository(db)

/** 履歴は accounts への FK を持つため、先に口座を用意してその ID を使う */
async function givenAccount(ownerUserId = HONEY_USER_ID): Promise<string> {
  const account = smbcAccount({ ownerUserId })
  await accounts.save(account)
  return account.common.accountId
}

describe('PostgresBalanceHistoryRepository', () => {
  it('追記した変動を発生日時の昇順で読み出す（下端は以上・上端は未満）', async () => {
    const accountId = await givenAccount()
    // 挿入順を時系列と逆にして、並べ替えが SQL 側で効いていることを確かめる
    await repo.append(
      balanceHistoryEntry({
        accountId,
        value: 200,
        occurredAt: new Date('2026-05-20T00:00:00.000Z'),
      }),
    )
    await repo.append(
      balanceHistoryEntry({
        accountId,
        value: 100,
        // 下端ちょうど = 範囲内
        occurredAt: new Date('2026-05-01T00:00:00.000Z'),
      }),
    )
    // 上端ちょうど = 範囲外
    await repo.append(
      balanceHistoryEntry({
        accountId,
        value: 300,
        occurredAt: new Date('2026-06-01T00:00:00.000Z'),
      }),
    )

    const found = await repo.findByOccurredAtRange(
      new Date('2026-05-01T00:00:00.000Z'),
      new Date('2026-06-01T00:00:00.000Z'),
    )
    expect(found.map(e => e.value)).toEqual([100, 200])
  })

  it('同じ (軸, 由来イベントID) の再追記は無視する（イベント再配信で点が重ならない）', async () => {
    const accountId = await givenAccount()
    const first = balanceHistoryEntry({
      accountId,
      value: 100,
      occurredAt: new Date('2026-05-10T00:00:00.000Z'),
      sourceEventId: 'evt-same',
    })
    await repo.append(first)
    // 履歴エントリIDは記録のたびに採番されるため、再配信でも主キーは衝突しない
    await repo.append(
      balanceHistoryEntry({
        accountId,
        value: 100,
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

  describe('findLatestPerAccountBefore', () => {
    it('(軸, 口座) ごとに直前の 1 件を返す', async () => {
      const mine = await givenAccount(HONEY_USER_ID)
      const spouse = await givenAccount(DARLING_USER_ID)
      await repo.append(
        balanceHistoryEntry({
          accountId: mine,
          axis: 'other_savings_balance',
          value: 100,
          occurredAt: new Date('2026-03-10T00:00:00.000Z'),
        }),
      )
      await repo.append(
        balanceHistoryEntry({
          accountId: mine,
          axis: 'other_savings_balance',
          value: 200,
          occurredAt: new Date('2026-04-10T00:00:00.000Z'),
        }),
      )
      await repo.append(
        balanceHistoryEntry({
          accountId: spouse,
          axis: 'other_savings_balance',
          value: 300,
          occurredAt: new Date('2026-04-20T00:00:00.000Z'),
        }),
      )

      const opening = await repo.findLatestPerAccountBefore(new Date('2026-05-01T00:00:00.000Z'))
      expect(opening.map(e => e.value).sort((a, b) => a - b)).toEqual([200, 300])
    })

    it('軸ごとに分かれて返る（別の軸の値が混ざらない）', async () => {
      const accountId = await givenAccount()
      await repo.append(
        balanceHistoryEntry({
          accountId,
          axis: 'nisa_contribution',
          value: 400000,
          occurredAt: new Date('2026-04-10T00:00:00.000Z'),
        }),
      )
      await repo.append(
        balanceHistoryEntry({
          accountId,
          axis: 'smbc_balance',
          value: 999,
          occurredAt: new Date('2026-04-20T00:00:00.000Z'),
        }),
      )

      const opening = await repo.findLatestPerAccountBefore(new Date('2026-05-01T00:00:00.000Z'))
      expect(opening.filter(e => e.axis === 'nisa_contribution').map(e => e.value)).toEqual([
        400000,
      ])
    })

    it('指定時刻ちょうどの点は含めない（未満）', async () => {
      const accountId = await givenAccount()
      await repo.append(
        balanceHistoryEntry({
          accountId,
          axis: 'nisa_contribution',
          occurredAt: new Date('2026-05-01T00:00:00.000Z'),
        }),
      )

      expect(await repo.findLatestPerAccountBefore(new Date('2026-05-01T00:00:00.000Z'))).toEqual(
        [],
      )
    })

    it('該当が無ければ空配列（0 で埋めない）', async () => {
      expect(await repo.findLatestPerAccountBefore(new Date('2026-05-01T00:00:00.000Z'))).toEqual(
        [],
      )
    })
  })
})
