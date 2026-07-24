import { describe, it, expect } from 'vitest'
import { NeonDashboardQuery } from '../../src/household-analysis/NeonDashboardQuery'
import { NeonTransactionRepository } from '../../src/household-analysis/NeonTransactionRepository'
import { NeonAccountRepository } from '../../src/balance-asset-tracking/NeonAccountRepository'
import { NeonMitsuiSumitomoUnpaidRepository } from '../../src/balance-asset-tracking/NeonMitsuiSumitomoUnpaidRepository'
import { db } from './setup'
import {
  HONEY_USER_ID,
  DARLING_USER_ID,
  cardAccount,
  classifiedTransaction,
  newCategoryId,
  nisaAccount,
  otherSavingsAccount,
  smbcAccount,
  unpaidAggregate,
  ym,
} from '../helpers/fixtures'
import { stubResolveCategoryNames, stubResolveViewerRole } from '../helpers/stubs'

const txRepo = new NeonTransactionRepository(db)
const accountRepo = new NeonAccountRepository(db)
const unpaidRepo = new NeonMitsuiSumitomoUnpaidRepository(db)

const CATEGORY_FOOD = newCategoryId()
const CATEGORY_DAILY = newCategoryId()

const query = new NeonDashboardQuery(db, {
  resolveCategoryNames: stubResolveCategoryNames({
    [CATEGORY_FOOD]: '食費',
    [CATEGORY_DAILY]: '日用品',
  }),
  resolveViewerRole: stubResolveViewerRole,
})

const JUL = ym('2026-07')

async function seedTransactions(): Promise<void> {
  // 世帯支出（両者）: 1200 + 3000
  await txRepo.save(
    classifiedTransaction({
      ownerUserId: HONEY_USER_ID,
      amount: 1200,
      categoryId: CATEGORY_FOOD,
      occurredAt: new Date('2026-07-05T03:00:00.000Z'),
    }),
  )
  await txRepo.save(
    classifiedTransaction({
      ownerUserId: DARLING_USER_ID,
      amount: 3000,
      categoryId: CATEGORY_DAILY,
      occurredAt: new Date('2026-07-06T03:00:00.000Z'),
    }),
  )
  // JST 月境界: JST 7/1 00:30（= UTC 6/30 15:30）は 7 月の世帯支出に入る
  await txRepo.save(
    classifiedTransaction({
      ownerUserId: HONEY_USER_ID,
      amount: 500,
      categoryId: CATEGORY_FOOD,
      occurredAt: new Date('2026-06-30T15:30:00.000Z'),
    }),
  )
  // JST 6/30 23:30（= UTC 6/30 14:30）は 6 月 → 7 月には入らない
  await txRepo.save(
    classifiedTransaction({
      ownerUserId: HONEY_USER_ID,
      amount: 100000,
      categoryId: CATEGORY_FOOD,
      occurredAt: new Date('2026-06-30T14:30:00.000Z'),
    }),
  )
  // honey の個人支出: 2000
  await txRepo.save(
    classifiedTransaction({
      ownerUserId: HONEY_USER_ID,
      expenseClass: 'personal_honey',
      amount: 2000,
      categoryId: CATEGORY_DAILY,
      occurredAt: new Date('2026-07-07T03:00:00.000Z'),
    }),
  )
  // darling の個人支出: 700（honey の個人モードには入らない）
  await txRepo.save(
    classifiedTransaction({
      ownerUserId: DARLING_USER_ID,
      expenseClass: 'personal_darling',
      amount: 700,
      categoryId: CATEGORY_DAILY,
      occurredAt: new Date('2026-07-07T04:00:00.000Z'),
    }),
  )
  // 経費(会社)は両モードで除外
  await txRepo.save(
    classifiedTransaction({
      ownerUserId: HONEY_USER_ID,
      expenseClass: 'business_expense',
      amount: 50000,
      categoryId: CATEGORY_DAILY,
      occurredAt: new Date('2026-07-08T03:00:00.000Z'),
    }),
  )
}

async function seedAccounts(): Promise<void> {
  await accountRepo.save(smbcAccount({ ownerUserId: HONEY_USER_ID, currentBalance: 1500000 }))
  await accountRepo.save(
    otherSavingsAccount({ ownerUserId: HONEY_USER_ID, currentBalance: 800000 }),
  )
  await accountRepo.save(nisaAccount({ ownerUserId: HONEY_USER_ID, currentAccumulated: 300000 }))
  const card = cardAccount({ ownerUserId: HONEY_USER_ID })
  await accountRepo.save(card)
  await unpaidRepo.save(
    unpaidAggregate({ accountId: card.common.accountId, bookedAmounts: [30000, 12000] }),
  )
  // darling の口座は honey の KPI に入らない
  await accountRepo.save(smbcAccount({ ownerUserId: DARLING_USER_ID, currentBalance: 999999 }))
}

describe('NeonDashboardQuery.fetchKpis', () => {
  it('世帯モード: 世帯支出合計（JST 月境界込み）+ viewer 所有口座の資産 KPI', async () => {
    await seedTransactions()
    await seedAccounts()
    const kpis = await query.fetchKpis(HONEY_USER_ID, JUL, 'household')
    expect(kpis.mode).toBe('household')
    expect(kpis.currentMonthSpending).toBe(1200 + 3000 + 500)
    expect(kpis.savingsBalance).toBe(1500000 + 800000)
    expect(kpis.nisaContributionAccumulated).toBe(300000)
    expect(kpis.totalAssets).toBe(1500000 + 800000 + 300000 - 42000)
  })

  it('個人モード: viewer の役割に対応する個人支出のみ（business_expense 除外）', async () => {
    await seedTransactions()
    await seedAccounts()
    const honeyKpis = await query.fetchKpis(HONEY_USER_ID, JUL, 'personal')
    expect(honeyKpis.currentMonthSpending).toBe(2000)
    const darlingKpis = await query.fetchKpis(DARLING_USER_ID, JUL, 'personal')
    expect(darlingKpis.currentMonthSpending).toBe(700)
  })

  it('C#10: 配偶者の個人合計を集計値として返す（08c L147 個人合計(配偶者)）', async () => {
    await seedTransactions()
    await seedAccounts()
    // honey から見た配偶者(darling)の個人合計 = darling の個人支出 700
    const honeyKpis = await query.fetchKpis(HONEY_USER_ID, JUL, 'personal')
    expect(honeyKpis.spousePersonalTotal).toBe(700)
    // darling から見た配偶者(honey)の個人合計 = honey の個人支出 2000
    const darlingKpis = await query.fetchKpis(DARLING_USER_ID, JUL, 'personal')
    expect(darlingKpis.spousePersonalTotal).toBe(2000)
  })

  it('データ 0 件でも 0 円 KPI を返す', async () => {
    const kpis = await query.fetchKpis(HONEY_USER_ID, JUL, 'household')
    expect(kpis.currentMonthSpending).toBe(0)
    expect(kpis.spousePersonalTotal).toBe(0)
    expect(kpis.savingsBalance).toBe(0)
    expect(kpis.totalAssets).toBe(0)
  })
})

describe('NeonDashboardQuery.fetchCategoryBreakdown', () => {
  it('世帯モード: カテゴリ別合計・件数・割合（合計降順、カテゴリ名解決）', async () => {
    await seedTransactions()
    const view = await query.fetchCategoryBreakdown(HONEY_USER_ID, JUL, 'household')
    expect(view.totalAmount).toBe(4700)
    // percentage は浮動小数点のため近似比較（実装の計算式変更に耐える）
    expect(view.items.map(({ percentage: _p, ...rest }) => rest)).toEqual([
      { categoryId: CATEGORY_DAILY, categoryName: '日用品', total: 3000, count: 1 },
      { categoryId: CATEGORY_FOOD, categoryName: '食費', total: 1700, count: 2 },
    ])
    expect(view.items[0]?.percentage).toBeCloseTo(63.83, 2)
    expect(view.items[1]?.percentage).toBeCloseTo(36.17, 2)
  })

  it('負値カテゴリ（返金超過）は percentage が 0–100 にクランプされる', async () => {
    // 食費 +2000、日用品 −500 → 合計 1500。素の割合は 133.3% / −33.3% になる
    await txRepo.save(
      classifiedTransaction({
        amount: 2000,
        categoryId: CATEGORY_FOOD,
        occurredAt: new Date('2026-07-10T03:00:00.000Z'),
      }),
    )
    await txRepo.save(
      classifiedTransaction({
        amount: -500,
        categoryId: CATEGORY_DAILY,
        occurredAt: new Date('2026-07-11T03:00:00.000Z'),
      }),
    )
    const view = await query.fetchCategoryBreakdown(HONEY_USER_ID, JUL, 'household')
    expect(view.totalAmount).toBe(1500)
    expect(view.items.map(i => ({ categoryId: i.categoryId, percentage: i.percentage }))).toEqual([
      { categoryId: CATEGORY_FOOD, percentage: 100 },
      { categoryId: CATEGORY_DAILY, percentage: 0 },
    ])
  })

  it('合計 0 円のときは全カテゴリの percentage が 0（ゼロ除算しない）', async () => {
    await txRepo.save(
      classifiedTransaction({
        amount: 1000,
        categoryId: CATEGORY_FOOD,
        occurredAt: new Date('2026-07-10T03:00:00.000Z'),
      }),
    )
    await txRepo.save(
      classifiedTransaction({
        amount: -1000,
        categoryId: CATEGORY_DAILY,
        occurredAt: new Date('2026-07-11T03:00:00.000Z'),
      }),
    )
    const view = await query.fetchCategoryBreakdown(HONEY_USER_ID, JUL, 'household')
    expect(view.totalAmount).toBe(0)
    expect(view.items).toHaveLength(2)
    for (const item of view.items) {
      expect(item.percentage).toBe(0)
    }
  })

  it('未解決カテゴリ ID は raw ID を表示名にフォールバックする', async () => {
    const unknownCategory = newCategoryId()
    await txRepo.save(
      classifiedTransaction({
        amount: 900,
        categoryId: unknownCategory,
        occurredAt: new Date('2026-07-09T03:00:00.000Z'),
      }),
    )
    const view = await query.fetchCategoryBreakdown(HONEY_USER_ID, JUL, 'household')
    expect(view.items[0]?.categoryName).toBe(unknownCategory)
  })
})

describe('NeonDashboardQuery プライバシー否定形テスト', () => {
  async function seedAllClasses(): Promise<void> {
    await txRepo.save(
      classifiedTransaction({
        ownerUserId: HONEY_USER_ID,
        amount: 1000,
        categoryId: CATEGORY_FOOD,
        occurredAt: new Date('2026-07-05T03:00:00.000Z'),
      }),
    )
    await txRepo.save(
      classifiedTransaction({
        ownerUserId: DARLING_USER_ID,
        amount: 2000,
        categoryId: CATEGORY_DAILY,
        occurredAt: new Date('2026-07-06T03:00:00.000Z'),
      }),
    )
    await txRepo.save(
      classifiedTransaction({
        ownerUserId: HONEY_USER_ID,
        expenseClass: 'personal_honey',
        amount: 3000,
        categoryId: CATEGORY_FOOD,
        occurredAt: new Date('2026-07-07T03:00:00.000Z'),
      }),
    )
    await txRepo.save(
      classifiedTransaction({
        ownerUserId: DARLING_USER_ID,
        expenseClass: 'personal_darling',
        amount: 4000,
        categoryId: CATEGORY_DAILY,
        occurredAt: new Date('2026-07-08T03:00:00.000Z'),
      }),
    )
    await txRepo.save(
      classifiedTransaction({
        ownerUserId: HONEY_USER_ID,
        expenseClass: 'business_expense',
        amount: 50000,
        categoryId: CATEGORY_FOOD,
        occurredAt: new Date('2026-07-09T03:00:00.000Z'),
      }),
    )
    await txRepo.save(
      classifiedTransaction({
        ownerUserId: DARLING_USER_ID,
        expenseClass: 'business_expense',
        amount: 60000,
        categoryId: CATEGORY_DAILY,
        occurredAt: new Date('2026-07-10T03:00:00.000Z'),
      }),
    )
  }

  it('fetchKpis 世帯モード: 経費(会社)は currentMonthSpending に含まれない', async () => {
    await seedAllClasses()
    const kpis = await query.fetchKpis(HONEY_USER_ID, JUL, 'household')
    expect(kpis.currentMonthSpending).toBe(1000 + 2000)
    expect(kpis.currentMonthSpending).not.toBe(1000 + 2000 + 50000 + 60000)
  })

  it('fetchKpis 個人モード: 配偶者の個人支出は currentMonthSpending に含まれない', async () => {
    await seedAllClasses()
    const honeyKpis = await query.fetchKpis(HONEY_USER_ID, JUL, 'personal')
    expect(honeyKpis.currentMonthSpending).toBe(3000)
    expect(honeyKpis.currentMonthSpending).not.toBe(3000 + 4000)
    const darlingKpis = await query.fetchKpis(DARLING_USER_ID, JUL, 'personal')
    expect(darlingKpis.currentMonthSpending).toBe(4000)
    expect(darlingKpis.currentMonthSpending).not.toBe(3000 + 4000)
  })

  it('fetchKpis 個人モード: 経費(会社)は currentMonthSpending に含まれない', async () => {
    await seedAllClasses()
    const honeyKpis = await query.fetchKpis(HONEY_USER_ID, JUL, 'personal')
    expect(honeyKpis.currentMonthSpending).toBe(3000)
    const darlingKpis = await query.fetchKpis(DARLING_USER_ID, JUL, 'personal')
    expect(darlingKpis.currentMonthSpending).toBe(4000)
  })

  it('fetchCategoryBreakdown 世帯モード: 経費(会社)カテゴリは内訳に現れない', async () => {
    await seedAllClasses()
    const view = await query.fetchCategoryBreakdown(HONEY_USER_ID, JUL, 'household')
    expect(view.totalAmount).toBe(1000 + 2000)
    expect(view.items).toHaveLength(2)
    for (const item of view.items) {
      expect(item.total).not.toBe(50000)
      expect(item.total).not.toBe(60000)
    }
  })

  it('fetchCategoryBreakdown 個人モード: 配偶者の個人カテゴリは含まれず本人分のみ', async () => {
    await seedAllClasses()
    const honeyView = await query.fetchCategoryBreakdown(HONEY_USER_ID, JUL, 'personal')
    expect(honeyView.totalAmount).toBe(3000)
    expect(honeyView.items).toHaveLength(1)
    expect(honeyView.items[0]?.categoryId).toBe(CATEGORY_FOOD)
    const darlingView = await query.fetchCategoryBreakdown(DARLING_USER_ID, JUL, 'personal')
    expect(darlingView.totalAmount).toBe(4000)
    expect(darlingView.items).toHaveLength(1)
    expect(darlingView.items[0]?.categoryId).toBe(CATEGORY_DAILY)
  })

  it('fetchCategoryBreakdown 個人モード: 経費(会社)は内訳に現れない', async () => {
    await seedAllClasses()
    const honeyView = await query.fetchCategoryBreakdown(HONEY_USER_ID, JUL, 'personal')
    expect(honeyView.totalAmount).toBe(3000)
    expect(honeyView.items.every(i => i.total !== 50000)).toBe(true)
    const darlingView = await query.fetchCategoryBreakdown(DARLING_USER_ID, JUL, 'personal')
    expect(darlingView.totalAmount).toBe(4000)
    expect(darlingView.items.every(i => i.total !== 60000)).toBe(true)
  })
})
