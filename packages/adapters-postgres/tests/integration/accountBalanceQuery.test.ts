import { describe, it, expect } from 'vitest'
import {
  addNisaContributionBySmbcTransfer,
  addOtherSavingsBySmbcTransfer,
  asNisaAccount,
  asOtherSavingsAccount,
  correctInitialBalance,
  correctOtherSavingsBalance,
  inactivateAccount,
  money,
  withdrawOtherSavings,
} from '@warimaru/domain'
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

const query = new NeonAccountBalanceQuery(db)

/** fetchAssetTotal(asOf) に渡すスナップショット時刻。テスト内の日付コメントの基準でもある */
const FIXED_NOW = new Date('2026-07-06T00:00:00.000Z')

describe('NeonAccountBalanceQuery.fetchBalanceList', () => {
  it('世帯共有: 両者の active 口座を kind 固定順で返す（inactive 除外）', async () => {
    const nisa = nisaAccount({ ownerUserId: DARLING_USER_ID })
    const smbc = smbcAccount({ ownerUserId: HONEY_USER_ID, currentBalance: 1500000 })
    const other = otherSavingsAccount({
      ownerUserId: DARLING_USER_ID,
      lastUpdatedAt: new Date('2026-06-26T00:00:00.000Z'),
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
      lastUpdatedAt: new Date('2026-06-26T00:00:00.000Z'),
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

// --- #397: 残高の手動操作が残高一覧・資産合計に反映されること ---

describe('残高の手動操作の反映', () => {
  it('取り崩しと振込由来の加算の結果が残高一覧と資産合計に反映される', async () => {
    const at = new Date('2026-07-05T00:00:00.000Z')
    const savings = asOtherSavingsAccount(
      otherSavingsAccount({ ownerUserId: DARLING_USER_ID, currentBalance: 700000 }),
    )
    const nisa = asNisaAccount(nisaAccount({ ownerUserId: DARLING_USER_ID }))
    const afterTransfer = addOtherSavingsBySmbcTransfer(savings, { amount: money(100000), at })
    await accountRepo.save(
      withdrawOtherSavings(afterTransfer, {
        amount: money(300000),
        operatorUserId: DARLING_USER_ID,
        at,
      }),
    )
    await accountRepo.save(addNisaContributionBySmbcTransfer(nisa, { amount: money(50000), at }))

    const list = await query.fetchBalanceList()
    expect(list.items).toContainEqual(
      expect.objectContaining({ kind: 'other_savings', currentBalance: 500000 }),
    )
    expect(list.items).toContainEqual(
      expect.objectContaining({ kind: 'nisa', currentAccumulated: 350000 }),
    )

    const total = await query.fetchAssetTotal(new Date('2026-07-06T00:00:00.000Z'))
    expect(total.otherSavingsBalance).toBe(500000)
    expect(total.nisaContributionAccumulated).toBe(350000)
    expect(total.total).toBe(850000)
  })

  it('手動補正は残高鮮度の根拠（最終更新日時）も更新する', async () => {
    // 鮮度根拠を更新しないと、補正で最新化した残高が「古い情報」として表示され続ける
    const stale = asOtherSavingsAccount(
      otherSavingsAccount({
        ownerUserId: DARLING_USER_ID,
        lastUpdatedAt: new Date('2026-05-01T00:00:00.000Z'), // FIXED_NOW から 66 日前
      }),
    )
    await accountRepo.save(
      correctOtherSavingsBalance(stale, {
        correctedBalance: money(432100),
        operatorUserId: DARLING_USER_ID,
        at: new Date('2026-07-04T00:00:00.000Z'), // FIXED_NOW から 2 日前
      }),
    )

    const list = await query.fetchBalanceList()
    expect(list.items).toContainEqual(
      expect.objectContaining({
        kind: 'other_savings',
        currentBalance: 432100,
        lastUpdatedAt: new Date('2026-07-04T00:00:00.000Z'),
      }),
    )
  })

  it('非アクティブ化した口座は残高一覧と資産合計から外れる', async () => {
    const savings = otherSavingsAccount({ ownerUserId: DARLING_USER_ID, currentBalance: 800000 })
    await accountRepo.save(savings)
    expect((await query.fetchAssetTotal(FIXED_NOW)).otherSavingsBalance).toBe(800000)

    await accountRepo.save(
      inactivateAccount(savings, {
        reason: '解約したため',
        operatorUserId: DARLING_USER_ID,
        at: new Date('2026-07-05T00:00:00Z'),
      }),
    )

    const list = await query.fetchBalanceList()
    expect(list.items.some(i => i.kind === 'other_savings')).toBe(false)
    expect((await query.fetchAssetTotal(FIXED_NOW)).otherSavingsBalance).toBe(0)
  })

  it('初期残高の後修正が残高一覧・資産合計に反映される', async () => {
    const savings = asOtherSavingsAccount(
      otherSavingsAccount({ ownerUserId: DARLING_USER_ID, currentBalance: 800000 }),
    )
    // fixture の初期残高は 500000。400000 に直すと現在残高も -100000 されて 700000
    const { account } = correctInitialBalance(savings, {
      initialBalance: money(400000),
      operatorUserId: DARLING_USER_ID,
      at: new Date('2026-07-05T00:00:00.000Z'),
    })
    await accountRepo.save(account)

    const list = await query.fetchBalanceList()
    expect(list.items).toContainEqual(
      expect.objectContaining({ kind: 'other_savings', currentBalance: 700000 }),
    )
    expect((await query.fetchAssetTotal(FIXED_NOW)).otherSavingsBalance).toBe(700000)
  })
})
