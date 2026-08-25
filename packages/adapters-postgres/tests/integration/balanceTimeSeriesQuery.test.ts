import { describe, it, expect } from 'vitest'
import { PostgresBalanceTimeSeriesQuery } from '../../src/balance-asset-tracking/PostgresBalanceTimeSeriesQuery'
import { PostgresBalanceHistoryRepository } from '../../src/balance-asset-tracking/PostgresBalanceHistoryRepository'
import { PostgresAccountRepository } from '../../src/balance-asset-tracking/PostgresAccountRepository'
import { db } from './setup'
import {
  DARLING_USER_ID,
  HONEY_USER_ID,
  balanceHistoryEntry,
  otherSavingsAccount,
  smbcAccount,
  ym,
} from '../helpers/fixtures'

const accounts = new PostgresAccountRepository(db)
const history = new PostgresBalanceHistoryRepository(db)
const query = new PostgresBalanceTimeSeriesQuery(db)

/** 履歴は accounts への FK を持つため、先に口座を用意してその ID を使う */
async function givenAccount(): Promise<string> {
  const account = smbcAccount()
  await accounts.save(account)
  return account.common.accountId
}

async function givenSavingsAccount(ownerUserId: typeof HONEY_USER_ID): Promise<string> {
  const account = otherSavingsAccount({ ownerUserId })
  await accounts.save(account)
  return account.common.accountId
}

describe('PostgresBalanceTimeSeriesQuery', () => {
  it('残高変動履歴から月範囲の 4 軸を date 昇順で合成する（記録が無い軸は空のまま。期間より前の最後の値は期間開始の補助点になる。#538）', async () => {
    const accountId = await givenAccount()
    // 挿入順を時系列と逆にして、並べ替えが SQL 側で効いていることを確かめる
    await history.append(
      balanceHistoryEntry({
        accountId,
        value: 1800000,
        occurredAt: new Date('2026-06-10T00:00:00.000Z'),
      }),
    )
    await history.append(
      balanceHistoryEntry({
        accountId,
        value: 1500000,
        occurredAt: new Date('2026-04-10T00:00:00.000Z'),
      }),
    )
    await history.append(
      balanceHistoryEntry({
        accountId,
        axis: 'nisa_contribution',
        value: 300000,
        occurredAt: new Date('2026-04-20T00:00:00.000Z'),
      }),
    )
    // 範囲外（前後の月。JST で 2026-03-31 23:00 と 2026-07-01 09:00）
    await history.append(
      balanceHistoryEntry({
        accountId,
        value: 100,
        occurredAt: new Date('2026-03-31T14:00:00.000Z'),
      }),
    )
    await history.append(
      balanceHistoryEntry({
        accountId,
        value: 200,
        occurredAt: new Date('2026-07-01T00:00:00.000Z'),
      }),
    )

    const view = await query.fetch(HONEY_USER_ID, ym('2026-04'), ym('2026-06'))
    expect(view.yearMonthRange).toEqual({ from: '2026-04', to: '2026-06' })
    // 先頭は期間より前の最後の値（100）を期間開始の補助点として持ち越したもの
    expect(view.smbc.map(p => p.amount)).toEqual([100, 1500000, 1800000])
    expect(view.smbc.map(p => p.isCarriedForward)).toEqual([true, false, false])
    expect(view.nisaContribution.map(p => p.amount)).toEqual([300000])
    expect(view.otherSavings).toEqual([])
    expect(view.cardUnpaid).toEqual([])
  })

  it('夫婦それぞれの貯蓄口座がある軸は世帯合算になる（口座別の点が交互に並ばない）', async () => {
    const mine = await givenSavingsAccount(HONEY_USER_ID)
    const spouse = await givenSavingsAccount(DARLING_USER_ID)
    await history.append(
      balanceHistoryEntry({
        accountId: mine,
        axis: 'other_savings_balance',
        value: 800000,
        occurredAt: new Date('2026-05-01T00:00:00.000Z'),
      }),
    )
    await history.append(
      balanceHistoryEntry({
        accountId: spouse,
        axis: 'other_savings_balance',
        value: 200000,
        occurredAt: new Date('2026-05-10T00:00:00.000Z'),
      }),
    )
    await history.append(
      balanceHistoryEntry({
        accountId: mine,
        axis: 'other_savings_balance',
        value: 750000,
        occurredAt: new Date('2026-05-20T00:00:00.000Z'),
      }),
    )

    const view = await query.fetch(HONEY_USER_ID, ym('2026-05'), ym('2026-05'))
    expect(view.otherSavings.map(p => p.amount)).toEqual([800000, 1000000, 950000])
  })

  it('期間より前に最後に動いた口座の残高も合計に入る（起点を持ち越し、期間開始の補助点も置く。#538）', async () => {
    const mine = await givenSavingsAccount(HONEY_USER_ID)
    const spouse = await givenSavingsAccount(DARLING_USER_ID)
    await history.append(
      balanceHistoryEntry({
        accountId: spouse,
        axis: 'other_savings_balance',
        value: 200000,
        occurredAt: new Date('2026-04-20T00:00:00.000Z'),
      }),
    )
    await history.append(
      balanceHistoryEntry({
        accountId: mine,
        axis: 'other_savings_balance',
        value: 800000,
        occurredAt: new Date('2026-05-01T00:00:00.000Z'),
      }),
    )

    const view = await query.fetch(HONEY_USER_ID, ym('2026-05'), ym('2026-05'))
    // 先頭は期間開始の補助点（配偶者の持ち越し分 200000 だけ）、続いて期間内の実際の記録
    expect(view.otherSavings).toHaveLength(2)
    expect(view.otherSavings[0]?.amount).toBe(200000)
    expect(view.otherSavings[0]?.isCarriedForward).toBe(true)
    expect(view.otherSavings[1]?.amount).toBe(1000000)
    expect(view.otherSavings[1]?.isCarriedForward).toBe(false)
  })

  it('月の境界は JST で切る（JST 深夜帯の変動が隣の月へずれない）', async () => {
    const accountId = await givenAccount()
    // 2026-05-01 00:30 JST = 2026-04-30 15:30 UTC。UTC で月を切ると 4 月に落ちる
    await history.append(
      balanceHistoryEntry({
        accountId,
        value: 111,
        occurredAt: new Date('2026-04-30T15:30:00.000Z'),
      }),
    )

    const may = await query.fetch(HONEY_USER_ID, ym('2026-05'), ym('2026-05'))
    expect(may.smbc.map(p => p.amount)).toEqual([111])
    const april = await query.fetch(HONEY_USER_ID, ym('2026-04'), ym('2026-04'))
    expect(april.smbc).toEqual([])
  })

  it('残高は世帯フルオープンのため、閲覧者が相手（配偶者）でも同じ 4 軸が返る', async () => {
    const accountId = await givenAccount() // 所有者は HONEY
    await history.append(
      balanceHistoryEntry({
        accountId,
        value: 1500000,
        occurredAt: new Date('2026-05-10T00:00:00.000Z'),
      }),
    )

    const owner = await query.fetch(HONEY_USER_ID, ym('2026-05'), ym('2026-05'))
    const spouse = await query.fetch(DARLING_USER_ID, ym('2026-05'), ym('2026-05'))
    expect(spouse).toEqual(owner)
    expect(spouse.smbc.map(p => p.amount)).toEqual([1500000])
  })

  it('期間中に一度も動きが無い軸でも、期間より前の最後の値があれば線が消えない（#538）', async () => {
    const accountId = await givenSavingsAccount(HONEY_USER_ID)
    await history.append(
      balanceHistoryEntry({
        accountId,
        axis: 'other_savings_balance',
        value: 500000,
        occurredAt: new Date('2026-03-01T00:00:00.000Z'),
      }),
    )

    // 2026-05 の間、この口座には一度も動きが無い
    const view = await query.fetch(HONEY_USER_ID, ym('2026-05'), ym('2026-05'))
    expect(view.otherSavings).toHaveLength(1)
    expect(view.otherSavings[0]?.amount).toBe(500000)
    expect(view.otherSavings[0]?.isCarriedForward).toBe(true)
  })

  it('変動が 1 件もない範囲は空の 4 軸を返す', async () => {
    const view = await query.fetch(HONEY_USER_ID, ym('2025-01'), ym('2025-03'))
    expect(view.smbc).toEqual([])
    expect(view.otherSavings).toEqual([])
    expect(view.nisaContribution).toEqual([])
    expect(view.cardUnpaid).toEqual([])
  })
})
