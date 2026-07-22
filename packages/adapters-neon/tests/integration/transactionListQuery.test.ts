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
  it('配偶者の個人取引は合計のみ可視（merchantName / amount が null）、経費(会社)と未分類は除外', async () => {
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
    // 経費(会社)・未分類（他人）・削除済みは除外され 2 件
    expect(items.map(i => i.transactionId).sort()).toEqual(
      [householdByDarling.common.transactionId, personalByDarling.common.transactionId].sort(),
    )
    const household = items.find(i => i.transactionId === householdByDarling.common.transactionId)
    expect(household?.merchantName).not.toBeNull()
    expect(household?.amount).toBe(3000)
    const personal = items.find(i => i.transactionId === personalByDarling.common.transactionId)
    expect(personal?.merchantName).toBeNull()
    expect(personal?.amount).toBeNull()
    expect(personal?.expenseClass).toBe('personal_darling')
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
})
