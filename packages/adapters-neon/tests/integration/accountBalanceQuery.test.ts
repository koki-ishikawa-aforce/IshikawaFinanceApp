import { describe, it, expect } from 'vitest'
import { NeonAccountBalanceQuery } from '../../src/balance-asset-tracking/NeonAccountBalanceQuery'
import { NeonAccountRepository } from '../../src/balance-asset-tracking/NeonAccountRepository'
import { NeonMitsuiSumitomoUnpaidRepository } from '../../src/balance-asset-tracking/NeonMitsuiSumitomoUnpaidRepository'
import { db } from './setup'
import {
  HONEY_USER_ID,
  DARLING_USER_ID,
  cardAccount,
  nisaAccount,
  otherSavingsAccount,
  smbcAccount,
  unpaidAggregate,
} from '../helpers/fixtures'

const accountRepo = new NeonAccountRepository(db)
const unpaidRepo = new NeonMitsuiSumitomoUnpaidRepository(db)

const FIXED_NOW = new Date('2026-07-06T00:00:00.000Z')
const query = new NeonAccountBalanceQuery(db, { now: () => FIXED_NOW })

describe('NeonAccountBalanceQuery.fetchBalanceList', () => {
  it('世帯共有: 両者の active 口座を kind 固定順で返す（inactive 除外）', async () => {
    const nisa = nisaAccount({ ownerUserId: DARLING_USER_ID })
    const smbc = smbcAccount({ ownerUserId: HONEY_USER_ID, currentBalance: 1500000 })
    const other = otherSavingsAccount({
      ownerUserId: DARLING_USER_ID,
      lastUpdatedAt: new Date('2026-06-26T00:00:00.000Z'), // 10 日前
    })
    const card = cardAccount({ ownerUserId: HONEY_USER_ID })
    const inactive = smbcAccount({ ownerUserId: DARLING_USER_ID, isActive: false })
    for (const account of [nisa, smbc, other, card, inactive]) {
      await accountRepo.save(account)
    }
    const unpaid = unpaidAggregate({
      accountId: card.common.accountId,
      bookedAmounts: [30000, 12000],
      withSettledEntry: true,
    })
    await unpaidRepo.save(unpaid)

    const view = await query.fetchBalanceList()
    expect(view.items.map(i => i.kind)).toEqual([
      'smbc_bank',
      'mitsui_sumitomo_card',
      'other_savings',
      'nisa',
    ])

    const [smbcItem, cardItem, otherItem, nisaItem] = view.items
    expect(smbcItem).toMatchObject({ displayName: '三井住友銀行', currentBalance: 1500000 })
    expect(cardItem).toMatchObject({
      displayName: '三井住友カード',
      currentMonthUnpaidTotal: 42000,
      lastSettledAt: unpaid.lastSettledAt,
    })
    expect(otherItem).toMatchObject({
      displayName: 'ゆうちょ銀行',
      currentBalance: 800000,
      daysSinceLastUpdate: 10,
    })
    expect(nisaItem).toMatchObject({ displayName: 'SBI証券', currentAccumulated: 300000 })
  })
})

describe('NeonAccountBalanceQuery.fetchAssetTotal', () => {
  it('両者の active 口座横断で合算し、total = 貯蓄 + NISA − カード未払金', async () => {
    const card = cardAccount({ ownerUserId: HONEY_USER_ID })
    for (const account of [
      smbcAccount({ ownerUserId: HONEY_USER_ID, currentBalance: 1500000 }),
      otherSavingsAccount({ ownerUserId: DARLING_USER_ID, currentBalance: 800000 }),
      nisaAccount({ ownerUserId: DARLING_USER_ID, currentAccumulated: 300000 }),
      card,
      smbcAccount({ ownerUserId: DARLING_USER_ID, currentBalance: 200000 }),
    ]) {
      await accountRepo.save(account)
    }
    await unpaidRepo.save(
      unpaidAggregate({ accountId: card.common.accountId, bookedAmounts: [42000] }),
    )

    const asOf = new Date('2026-07-06T01:00:00.000Z')
    const view = await query.fetchAssetTotal(asOf)
    expect(view.asOf).toEqual(asOf)
    expect(view.smbcBalance).toBe(1500000 + 200000)
    expect(view.otherSavingsBalance).toBe(800000)
    expect(view.nisaContributionAccumulated).toBe(300000)
    expect(view.cardUnpaidTotal).toBe(42000)
    expect(view.total).toBe(1700000 + 800000 + 300000 - 42000)
  })

  it('口座 0 件でも 0 円の View を返す', async () => {
    const view = await query.fetchAssetTotal(new Date('2026-07-06T01:00:00.000Z'))
    expect(view.total).toBe(0)
  })
})
