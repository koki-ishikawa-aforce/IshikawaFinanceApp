import { describe, it, expect } from 'vitest'
import type { ExpenseClass } from '@warimaru/domain'
import { NeonTransactionListQuery } from '../../src/household-analysis/NeonTransactionListQuery'
import { NeonTransactionRepository } from '../../src/household-analysis/NeonTransactionRepository'
import { db } from './setup'
import {
  HONEY_USER_ID,
  DARLING_USER_ID,
  classifiedTransaction,
  deletedTransaction,
  newCategoryId,
  unclassifiedTransaction,
  ym,
} from '../helpers/fixtures'
import { stubResolveCategoryNames, stubResolveViewerRole } from '../helpers/stubs'

const repo = new NeonTransactionRepository(db)

const CATEGORY_FOOD = newCategoryId()

const query = new NeonTransactionListQuery(db, {
  resolveCategoryNames: stubResolveCategoryNames({ [CATEGORY_FOOD]: '食費' }),
  resolveViewerRole: stubResolveViewerRole,
})

const JUL = ym('2026-07')

describe('NeonTransactionListQuery.fetch（プライバシー 3 段階）', () => {
  it('配偶者の個人取引・経費(会社)・未分類・削除済みはリストから完全除外され、世帯取引のみ残る（A①）', async () => {
    const householdByDarling = classifiedTransaction({
      ownerUserId: DARLING_USER_ID,
      amount: 3000,
      categoryId: CATEGORY_FOOD,
      occurredAt: new Date('2026-07-05T03:00:00.000Z'),
    })
    const personalByDarling = classifiedTransaction({
      ownerUserId: DARLING_USER_ID,
      expenseClass: 'personal_darling',
      merchantName: 'ダーリンの店',
      amount: 700,
      occurredAt: new Date('2026-07-06T03:00:00.000Z'),
    })
    const businessByDarling = classifiedTransaction({
      ownerUserId: DARLING_USER_ID,
      expenseClass: 'business_expense',
      amount: 50000,
      occurredAt: new Date('2026-07-07T03:00:00.000Z'),
    })
    const unclassifiedByDarling = unclassifiedTransaction({
      ownerUserId: DARLING_USER_ID,
      defaultExpenseClass: 'personal_darling',
      occurredAt: new Date('2026-07-08T03:00:00.000Z'),
    })
    const deletedByHoney = deletedTransaction({
      ownerUserId: HONEY_USER_ID,
      occurredAt: new Date('2026-07-09T03:00:00.000Z'),
    })
    for (const tx of [
      householdByDarling,
      personalByDarling,
      businessByDarling,
      unclassifiedByDarling,
      deletedByHoney,
    ]) {
      await repo.save(tx)
    }

    const items = await query.fetch(HONEY_USER_ID, { month: JUL })
    // A①: 配偶者の個人・経費(会社)・未分類（他人）・削除済みはリストから完全除外され、
    // 世帯取引のみが残る（伏せ字行は残さない）。個人合計は集計値（ダッシュボード等）で別途提供する。
    expect(items.map(i => i.transactionId)).toEqual([householdByDarling.common.transactionId])
    const household = items.find(i => i.transactionId === householdByDarling.common.transactionId)
    expect(household?.merchantName).not.toBeNull()
    expect(household?.amount).toBe(3000)
    // 配偶者の個人取引は明細行として一切現れない
    expect(
      items.find(i => i.transactionId === personalByDarling.common.transactionId),
    ).toBeUndefined()
  })

  it('本人の取引は個人・経費(会社)・未分類すべて明細可視', async () => {
    const personal = classifiedTransaction({
      ownerUserId: HONEY_USER_ID,
      expenseClass: 'personal_honey',
      amount: 2000,
      occurredAt: new Date('2026-07-05T03:00:00.000Z'),
    })
    const business = classifiedTransaction({
      ownerUserId: HONEY_USER_ID,
      expenseClass: 'business_expense',
      amount: 50000,
      occurredAt: new Date('2026-07-06T03:00:00.000Z'),
    })
    const unclassified = unclassifiedTransaction({
      ownerUserId: HONEY_USER_ID,
      amount: 800,
      occurredAt: new Date('2026-07-07T03:00:00.000Z'),
    })
    for (const tx of [personal, business, unclassified]) {
      await repo.save(tx)
    }

    const items = await query.fetch(HONEY_USER_ID, { month: JUL })
    expect(items).toHaveLength(3)
    for (const item of items) {
      expect(item.merchantName).not.toBeNull()
      expect(item.amount).not.toBeNull()
    }
    const unclassifiedItem = items.find(i => i.isUnclassified)
    expect(unclassifiedItem?.expenseClass).toBe('personal_honey')
    expect(unclassifiedItem?.categoryId).toBeNull()
  })

  it('expenseClass フィルタは未分類の defaultExpenseClass も拾う（メモリ適用）', async () => {
    const classified = classifiedTransaction({
      ownerUserId: HONEY_USER_ID,
      expenseClass: 'personal_honey',
      occurredAt: new Date('2026-07-05T03:00:00.000Z'),
    })
    const unclassified = unclassifiedTransaction({
      ownerUserId: HONEY_USER_ID,
      defaultExpenseClass: 'personal_honey',
      occurredAt: new Date('2026-07-06T03:00:00.000Z'),
    })
    const household = classifiedTransaction({
      ownerUserId: HONEY_USER_ID,
      occurredAt: new Date('2026-07-07T03:00:00.000Z'),
    })
    for (const tx of [classified, unclassified, household]) {
      await repo.save(tx)
    }

    const items = await query.fetch(HONEY_USER_ID, {
      month: JUL,
      expenseClass: 'personal_honey' as ExpenseClass,
    })
    expect(items.map(i => i.transactionId).sort()).toEqual(
      [classified.common.transactionId, unclassified.common.transactionId].sort(),
    )
  })

  it('categoryId フィルタは該当カテゴリの取引のみ返す（未分類は categoryId null のため落ちる）', async () => {
    const otherCategory = newCategoryId()
    const food = classifiedTransaction({
      ownerUserId: HONEY_USER_ID,
      categoryId: CATEGORY_FOOD,
      occurredAt: new Date('2026-07-05T03:00:00.000Z'),
    })
    const foodByDarling = classifiedTransaction({
      ownerUserId: DARLING_USER_ID,
      categoryId: CATEGORY_FOOD,
      amount: 4500,
      occurredAt: new Date('2026-07-06T03:00:00.000Z'),
    })
    const other = classifiedTransaction({
      ownerUserId: HONEY_USER_ID,
      categoryId: otherCategory,
      occurredAt: new Date('2026-07-07T03:00:00.000Z'),
    })
    const unclassified = unclassifiedTransaction({
      ownerUserId: HONEY_USER_ID,
      occurredAt: new Date('2026-07-08T03:00:00.000Z'),
    })
    for (const tx of [food, foodByDarling, other, unclassified]) {
      await repo.save(tx)
    }

    const items = await query.fetch(HONEY_USER_ID, { month: JUL, categoryId: CATEGORY_FOOD })
    // 世帯取引は配偶者所有分もカテゴリ明細に含まれる
    expect(items.map(i => i.transactionId).sort()).toEqual(
      [food.common.transactionId, foodByDarling.common.transactionId].sort(),
    )
    expect(items.every(i => i.categoryId === CATEGORY_FOOD)).toBe(true)
  })

  it('categoryId フィルタはプライバシー適用後に絞る（配偶者の個人も経費(会社)もリストから完全除外、A①）', async () => {
    const personalByDarling = classifiedTransaction({
      ownerUserId: DARLING_USER_ID,
      expenseClass: 'personal_darling',
      categoryId: CATEGORY_FOOD,
      merchantName: 'ダーリンの店',
      amount: 700,
      occurredAt: new Date('2026-07-05T03:00:00.000Z'),
    })
    const businessByDarling = classifiedTransaction({
      ownerUserId: DARLING_USER_ID,
      expenseClass: 'business_expense',
      categoryId: CATEGORY_FOOD,
      amount: 50000,
      occurredAt: new Date('2026-07-06T03:00:00.000Z'),
    })
    for (const tx of [personalByDarling, businessByDarling]) {
      await repo.save(tx)
    }

    const items = await query.fetch(HONEY_USER_ID, { month: JUL, categoryId: CATEGORY_FOOD })
    // A①: 配偶者の個人取引（伏せ字行を廃止）も経費(会社)もリスト自体から除外されるため、
    // カテゴリ一致でも 0 件になる
    expect(items).toHaveLength(0)
  })

  it('isUnclassifiedOnly は未分類のみ返す', async () => {
    await repo.save(
      classifiedTransaction({
        ownerUserId: HONEY_USER_ID,
        occurredAt: new Date('2026-07-05T03:00:00.000Z'),
      }),
    )
    const unclassified = unclassifiedTransaction({
      ownerUserId: HONEY_USER_ID,
      occurredAt: new Date('2026-07-06T03:00:00.000Z'),
    })
    await repo.save(unclassified)

    const items = await query.fetch(HONEY_USER_ID, { month: JUL, isUnclassifiedOnly: true })
    expect(items.map(i => i.transactionId)).toEqual([unclassified.common.transactionId])
  })
})

describe('NeonTransactionListQuery プライバシー否定形テスト', () => {
  it('darling から honey の個人取引・経費(会社)・未分類はリストから完全除外される（対称性）', async () => {
    const personalByHoney = classifiedTransaction({
      ownerUserId: HONEY_USER_ID,
      expenseClass: 'personal_honey',
      merchantName: 'ハニーの店',
      amount: 2000,
      occurredAt: new Date('2026-07-05T03:00:00.000Z'),
    })
    const businessByHoney = classifiedTransaction({
      ownerUserId: HONEY_USER_ID,
      expenseClass: 'business_expense',
      amount: 80000,
      occurredAt: new Date('2026-07-06T03:00:00.000Z'),
    })
    const unclassifiedByHoney = unclassifiedTransaction({
      ownerUserId: HONEY_USER_ID,
      defaultExpenseClass: 'personal_honey',
      occurredAt: new Date('2026-07-07T03:00:00.000Z'),
    })
    const householdByHoney = classifiedTransaction({
      ownerUserId: HONEY_USER_ID,
      amount: 1500,
      categoryId: CATEGORY_FOOD,
      occurredAt: new Date('2026-07-08T03:00:00.000Z'),
    })
    for (const tx of [personalByHoney, businessByHoney, unclassifiedByHoney, householdByHoney]) {
      await repo.save(tx)
    }

    const items = await query.fetch(DARLING_USER_ID, { month: JUL })
    expect(items.map(i => i.transactionId)).toEqual([householdByHoney.common.transactionId])
    expect(
      items.find(i => i.transactionId === personalByHoney.common.transactionId),
    ).toBeUndefined()
    expect(
      items.find(i => i.transactionId === businessByHoney.common.transactionId),
    ).toBeUndefined()
    expect(
      items.find(i => i.transactionId === unclassifiedByHoney.common.transactionId),
    ).toBeUndefined()
  })

  it('配偶者の経費(会社)は expenseClass フィルタでも取得できない（両方向）', async () => {
    await repo.save(
      classifiedTransaction({
        ownerUserId: DARLING_USER_ID,
        expenseClass: 'business_expense',
        amount: 99000,
        occurredAt: new Date('2026-07-05T03:00:00.000Z'),
      }),
    )
    await repo.save(
      classifiedTransaction({
        ownerUserId: HONEY_USER_ID,
        expenseClass: 'business_expense',
        amount: 88000,
        occurredAt: new Date('2026-07-06T03:00:00.000Z'),
      }),
    )
    const honeyItems = await query.fetch(HONEY_USER_ID, {
      month: JUL,
      expenseClass: 'business_expense' as ExpenseClass,
    })
    expect(honeyItems).toHaveLength(1)
    expect(honeyItems[0]?.amount).toBe(88000)
    const darlingItems = await query.fetch(DARLING_USER_ID, {
      month: JUL,
      expenseClass: 'business_expense' as ExpenseClass,
    })
    expect(darlingItems).toHaveLength(1)
    expect(darlingItems[0]?.amount).toBe(99000)
  })
})

describe('NeonTransactionListQuery.fetchUnclassifiedSummary', () => {
  it('本人の未分類のみ数え、recentIds は直近 5 件（occurredAt 降順）', async () => {
    const own = await Promise.all(
      Array.from({ length: 7 }, (_, i) => {
        const tx = unclassifiedTransaction({
          ownerUserId: HONEY_USER_ID,
          occurredAt: new Date(`2026-07-${String(i + 1).padStart(2, '0')}T03:00:00.000Z`),
        })
        return repo.save(tx).then(() => tx)
      }),
    )
    // 配偶者の未分類はカウントに入らない
    await repo.save(
      unclassifiedTransaction({
        ownerUserId: DARLING_USER_ID,
        occurredAt: new Date('2026-07-10T03:00:00.000Z'),
      }),
    )

    const summary = await query.fetchUnclassifiedSummary(HONEY_USER_ID, JUL)
    expect(summary.count).toBe(7)
    expect(summary.recentIds).toHaveLength(5)
    const expectedRecent = own
      .sort((a, b) => b.common.occurredAt.getTime() - a.common.occurredAt.getTime())
      .slice(0, 5)
      .map(tx => tx.common.transactionId)
    expect(summary.recentIds).toEqual(expectedRecent)
  })

  it('配偶者の未分類は件数にも recentIds にも含まれない', async () => {
    const spouseTx = unclassifiedTransaction({
      ownerUserId: DARLING_USER_ID,
      occurredAt: new Date('2026-07-05T03:00:00.000Z'),
    })
    await repo.save(spouseTx)
    const ownTx = unclassifiedTransaction({
      ownerUserId: HONEY_USER_ID,
      occurredAt: new Date('2026-07-06T03:00:00.000Z'),
    })
    await repo.save(ownTx)

    const summary = await query.fetchUnclassifiedSummary(HONEY_USER_ID, JUL)
    expect(summary.count).toBe(1)
    expect(summary.recentIds).toEqual([ownTx.common.transactionId])
    expect(summary.recentIds).not.toContain(spouseTx.common.transactionId)
  })
})
