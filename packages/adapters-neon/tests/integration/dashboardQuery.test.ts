import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { NeonDashboardQuery } from '../../src/household-analysis/NeonDashboardQuery'
import { NeonTransactionRepository } from '../../src/household-analysis/NeonTransactionRepository'
import { NeonAccountRepository } from '../../src/balance-asset-tracking/NeonAccountRepository'
import { NeonMitsuiSumitomoUnpaidRepository } from '../../src/balance-asset-tracking/NeonMitsuiSumitomoUnpaidRepository'
import { createTestDb, resetDb } from '../helpers/db'
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

const { db, close } = createTestDb()
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

beforeEach(() => resetDb(db))
afterAll(() => close())

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

  it('データ 0 件でも 0 円 KPI を返す', async () => {
    const kpis = await query.fetchKpis(HONEY_USER_ID, JUL, 'household')
    expect(kpis.currentMonthSpending).toBe(0)
    expect(kpis.savingsBalance).toBe(0)
    expect(kpis.totalAssets).toBe(0)
  })
})

describe('NeonDashboardQuery.fetchCategoryBreakdown', () => {
  it('世帯モード: カテゴリ別合計・件数・割合（合計降順、カテゴリ名解決）', async () => {
    await seedTransactions()
    const view = await query.fetchCategoryBreakdown(HONEY_USER_ID, JUL, 'household')
    expect(view.totalAmount).toBe(4700)
    expect(view.items).toEqual([
      {
        categoryId: CATEGORY_DAILY,
        categoryName: '日用品',
        total: 3000,
        count: 1,
        percentage: (3000 / 4700) * 100,
      },
      {
        categoryId: CATEGORY_FOOD,
        categoryName: '食費',
        total: 1700,
        count: 2,
        percentage: (1700 / 4700) * 100,
      },
    ])
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
