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
  reactivateAccount,
  withdrawOtherSavings,
} from '@warimaru/domain'
import { PostgresAccountBalanceQuery } from '../../src/balance-asset-tracking/PostgresAccountBalanceQuery'
import { PostgresAccountRepository } from '../../src/balance-asset-tracking/PostgresAccountRepository'
import { PostgresMitsuiSumitomoUnpaidRepository } from '../../src/balance-asset-tracking/PostgresMitsuiSumitomoUnpaidRepository'
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

const accountRepo = new PostgresAccountRepository(db)
const unpaidRepo = new PostgresMitsuiSumitomoUnpaidRepository(db)

const query = new PostgresAccountBalanceQuery(db)

/** fetchAssetTotal(asOf) に渡すスナップショット時刻。テスト内の日付コメントの基準でもある */
const FIXED_NOW = new Date('2026-07-06T00:00:00.000Z')

describe('PostgresAccountBalanceQuery.fetchBalanceList', () => {
  it('閲覧者本人の active 口座を kind 固定順で返す', async () => {
    const nisa = nisaAccount({ ownerUserId: DARLING_USER_ID })
    const smbc = smbcAccount({ ownerUserId: DARLING_USER_ID, currentBalance: 1500000 })
    const other = otherSavingsAccount({
      ownerUserId: DARLING_USER_ID,
      lastUpdatedAt: new Date('2026-06-26T00:00:00.000Z'),
    })
    const card = cardAccount({ ownerUserId: DARLING_USER_ID })
    for (const account of [nisa, smbc, other, card]) {
      await accountRepo.save(account)
    }
    const unpaid = unpaidAggregate({
      accountId: card.common.accountId,
      bookedAmounts: [30000, 12000],
      withSettledEntry: true,
    })
    await unpaidRepo.save(unpaid)

    const view = await query.fetchBalanceList(DARLING_USER_ID)
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

  it('本人の inactive 口座は一覧に出ない', async () => {
    await accountRepo.save(smbcAccount({ ownerUserId: DARLING_USER_ID, isActive: false }))

    const view = await query.fetchBalanceList(DARLING_USER_ID)
    expect(view.items).toEqual([])
  })

  // --- P2-B5 / AT-404 / OQ-60: 配偶者の口座は 1 件ずつ見えない ---

  it('配偶者の口座は 1 件も一覧に出ず、別銀行貯蓄 + NISA の合計だけが返る', async () => {
    const spouseCard = cardAccount({ ownerUserId: HONEY_USER_ID })
    for (const account of [
      smbcAccount({ ownerUserId: HONEY_USER_ID, currentBalance: 1500000 }),
      spouseCard,
      otherSavingsAccount({
        ownerUserId: HONEY_USER_ID,
        currentBalance: 800000,
        bankName: '楽天銀行',
      }),
      nisaAccount({ ownerUserId: HONEY_USER_ID, currentAccumulated: 300000 }),
      // 閲覧者本人の口座（合計に混ぜてはならない）
      otherSavingsAccount({ ownerUserId: DARLING_USER_ID, currentBalance: 90000 }),
    ]) {
      await accountRepo.save(account)
    }
    await unpaidRepo.save(
      unpaidAggregate({ accountId: spouseCard.common.accountId, bookedAmounts: [42000] }),
    )

    const view = await query.fetchBalanceList(DARLING_USER_ID)

    // 配偶者の口座は種別も銀行名も件数も漏れない（本人の別銀行貯蓄 1 件だけが並ぶ）
    expect(view.items).toHaveLength(1)
    expect(view.items[0]).toMatchObject({ kind: 'other_savings', currentBalance: 90000 })
    expect(JSON.stringify(view.items)).not.toContain('楽天銀行')
    // 配偶者の SMBC 残高（1,500,000）・カード未払金（42,000）は合計にも含めない。
    // 合計は配偶者の別銀行貯蓄 800,000 + NISA 300,000 のみ
    expect(view.spouseOtherSavingsAndNisaTotal).toBe(1100000)
  })

  it('配偶者の別銀行貯蓄が残高 0 円でも合計は 0 を返す（null にしない）', async () => {
    // 取り崩して 0 円になった状態を「口座が無い」に倒すと、合計行が黙って画面から消える
    await accountRepo.save(otherSavingsAccount({ ownerUserId: HONEY_USER_ID, currentBalance: 0 }))

    const view = await query.fetchBalanceList(DARLING_USER_ID)
    expect(view.spouseOtherSavingsAndNisaTotal).toBe(0)
  })

  it('配偶者の inactive な別銀行貯蓄・NISA は合計に含めない', async () => {
    const inactiveSavings = otherSavingsAccount({
      ownerUserId: HONEY_USER_ID,
      currentBalance: 800000,
    })
    await accountRepo.save(inactiveSavings)
    await accountRepo.save(
      inactivateAccount(inactiveSavings, {
        reason: '解約したため',
        operatorUserId: HONEY_USER_ID,
        at: new Date('2026-07-05T00:00:00.000Z'),
      }),
    )
    await accountRepo.save(nisaAccount({ ownerUserId: HONEY_USER_ID, currentAccumulated: 300000 }))

    const view = await query.fetchBalanceList(DARLING_USER_ID)
    expect(view.spouseOtherSavingsAndNisaTotal).toBe(300000)
  })

  it('配偶者に別銀行貯蓄も NISA も無ければ合計は null（0 円と区別する）', async () => {
    await accountRepo.save(smbcAccount({ ownerUserId: HONEY_USER_ID }))
    await accountRepo.save(otherSavingsAccount({ ownerUserId: DARLING_USER_ID }))

    const view = await query.fetchBalanceList(DARLING_USER_ID)
    expect(view.spouseOtherSavingsAndNisaTotal).toBeNull()
  })
})

describe('PostgresAccountBalanceQuery.fetchAssetTotal', () => {
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

    const list = await query.fetchBalanceList(DARLING_USER_ID)
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

    const list = await query.fetchBalanceList(DARLING_USER_ID)
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

    const list = await query.fetchBalanceList(DARLING_USER_ID)
    expect(list.items.some(i => i.kind === 'other_savings')).toBe(false)
    expect((await query.fetchAssetTotal(FIXED_NOW)).otherSavingsBalance).toBe(0)
  })

  it('再アクティブ化した口座は残高一覧と資産合計に戻る（#457）', async () => {
    const savings = otherSavingsAccount({ ownerUserId: DARLING_USER_ID, currentBalance: 800000 })
    await accountRepo.save(savings)
    await accountRepo.save(
      inactivateAccount(savings, {
        reason: '解約したため',
        operatorUserId: DARLING_USER_ID,
        at: new Date('2026-07-05T00:00:00Z'),
      }),
    )
    expect((await query.fetchAssetTotal(FIXED_NOW)).otherSavingsBalance).toBe(0)

    // 保存済みの版を読み直してから戻す（版数照合。#459）
    const stored = await accountRepo.findById(savings.common.accountId)
    if (stored === null) throw new Error('unreachable')
    const { account } = reactivateAccount(stored, { operatorUserId: DARLING_USER_ID })
    await accountRepo.save(account)

    const list = await query.fetchBalanceList(DARLING_USER_ID)
    expect(list.items).toContainEqual(
      expect.objectContaining({
        accountId: savings.common.accountId,
        kind: 'other_savings',
        currentBalance: 800000,
      }),
    )
    expect((await query.fetchAssetTotal(FIXED_NOW)).otherSavingsBalance).toBe(800000)

    // is_active 列だけでなく payload 側も戻っていること。ここがずれると一覧は正しく見えるのに
    // 読み直した集約は非アクティブのままで、以降の残高操作が拒否され続ける
    const reloaded = await accountRepo.findById(savings.common.accountId)
    expect(reloaded?.common.activeness).toEqual({ kind: 'active' })
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

    const list = await query.fetchBalanceList(DARLING_USER_ID)
    expect(list.items).toContainEqual(
      expect.objectContaining({ kind: 'other_savings', currentBalance: 700000 }),
    )
    expect((await query.fetchAssetTotal(FIXED_NOW)).otherSavingsBalance).toBe(700000)
  })
})
