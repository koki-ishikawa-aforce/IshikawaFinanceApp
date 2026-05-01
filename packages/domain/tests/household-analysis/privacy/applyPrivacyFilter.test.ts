import { describe, it, expect } from 'vitest'
import { toListItems, isVisibleAsDetail, isVisibleAsAggregate } from '../../../src/household-analysis/privacy/applyPrivacyFilter'
import type { ViewerContext } from '../../../src/household-analysis/privacy/ViewerContext'
import type { Transaction, ClassifiedTransaction } from '../../../src/household-analysis/aggregates/Transaction'

const HONEY_ID = 'user_honey' as never
const DARLING_ID = 'user_darling' as never

const honeyViewer: ViewerContext = { viewerId: HONEY_ID, role: 'honey' }
const darlingViewer: ViewerContext = { viewerId: DARLING_ID, role: 'darling' }

function makeClassified(ownerId: string, expenseClass: 'household' | 'personal_honey' | 'personal_darling' | 'business_expense'): ClassifiedTransaction {
  const expenseTypeRef = expenseClass === 'business_expense'
    ? { kind: 'business' as const, expenseTypeId: 'exp_001' as never }
    : { kind: 'non_business' as const }
  return {
    kind: 'classified',
    common: {
      transactionId: `tx_${ownerId}_${expenseClass}` as never,
      ownerUserId: ownerId as never,
      merchantName: 'スーパーA',
      amount: 1000 as never,
      occurredAt: new Date(),
      importSource: { kind: 'manual', enteredAt: new Date(), enteredByUserId: ownerId as never },
    },
    details: {
      categoryId: 'cat_001' as never,
      expenseClass,
      expenseTypeRef,
      basis: { kind: 'user_manual', modifiedByUserId: ownerId as never, modifiedAt: new Date() },
    },
  }
}

describe('applyPrivacyFilter', () => {
  describe('isVisibleAsDetail マトリクス', () => {
    it('世帯費用は両者に明細可視', () => {
      const tx = makeClassified(HONEY_ID, 'household')
      expect(isVisibleAsDetail(tx, honeyViewer)).toBe(true)
      expect(isVisibleAsDetail(tx, darlingViewer)).toBe(true)
    })

    it('個人(本人) は本人のみ明細可視', () => {
      const tx = makeClassified(HONEY_ID, 'personal_honey')
      expect(isVisibleAsDetail(tx, honeyViewer)).toBe(true)
      expect(isVisibleAsDetail(tx, darlingViewer)).toBe(false)
    })

    it('経費(会社) は本人のみ明細可視', () => {
      const tx = makeClassified(HONEY_ID, 'business_expense')
      expect(isVisibleAsDetail(tx, honeyViewer)).toBe(true)
      expect(isVisibleAsDetail(tx, darlingViewer)).toBe(false)
    })
  })

  describe('isVisibleAsAggregate マトリクス', () => {
    it('世帯費用は両者の合計に含まれる', () => {
      const tx = makeClassified(HONEY_ID, 'household')
      expect(isVisibleAsAggregate(tx, honeyViewer)).toBe(true)
      expect(isVisibleAsAggregate(tx, darlingViewer)).toBe(true)
    })

    it('個人(本人) は両者の合計に含まれる（合計のみ可視）', () => {
      const tx = makeClassified(HONEY_ID, 'personal_honey')
      expect(isVisibleAsAggregate(tx, honeyViewer)).toBe(true)
      expect(isVisibleAsAggregate(tx, darlingViewer)).toBe(true)
    })

    it('経費(会社) は本人の合計のみ含まれる', () => {
      const tx = makeClassified(HONEY_ID, 'business_expense')
      expect(isVisibleAsAggregate(tx, honeyViewer)).toBe(true)
      expect(isVisibleAsAggregate(tx, darlingViewer)).toBe(false)
    })
  })

  describe('toListItems', () => {
    const categoryNames = new Map<string, string>([['cat_001', '食費']])

    it('経費(会社) で他人の取引はリストから除外', () => {
      const txs: Transaction[] = [makeClassified(HONEY_ID, 'business_expense')]
      const items = toListItems(txs, darlingViewer, categoryNames)
      expect(items).toHaveLength(0)
    })

    it('経費(会社) で本人の取引はリストに含まれる', () => {
      const txs: Transaction[] = [makeClassified(HONEY_ID, 'business_expense')]
      const items = toListItems(txs, honeyViewer, categoryNames)
      expect(items).toHaveLength(1)
      expect(items[0]?.merchantName).toBe('スーパーA')
      expect(items[0]?.amount).toBe(1000)
    })

    it('個人(本人) の取引は配偶者には merchantName / amount が null', () => {
      const txs: Transaction[] = [makeClassified(HONEY_ID, 'personal_honey')]
      const items = toListItems(txs, darlingViewer, categoryNames)
      expect(items).toHaveLength(1)
      expect(items[0]?.merchantName).toBeNull()
      expect(items[0]?.amount).toBeNull()
    })

    it('世帯費用は両者に明細可視', () => {
      const txs: Transaction[] = [makeClassified(HONEY_ID, 'household')]
      const items = toListItems(txs, darlingViewer, categoryNames)
      expect(items).toHaveLength(1)
      expect(items[0]?.merchantName).toBe('スーパーA')
      expect(items[0]?.amount).toBe(1000)
    })

    it('未分類取引は所有者本人のみリスト掲載（配偶者は除外）', () => {
      const txs: Transaction[] = [
        {
          kind: 'unclassified',
          common: {
            transactionId: 'tx_unclass' as never,
            ownerUserId: HONEY_ID,
            merchantName: '不明加盟店',
            amount: 500 as never,
            occurredAt: new Date(),
            importSource: { kind: 'manual', enteredAt: new Date(), enteredByUserId: HONEY_ID },
          },
          reason: 'merchant_rule_unlearned',
          defaultExpenseClass: 'personal_honey',
        },
      ]
      expect(toListItems(txs, honeyViewer, categoryNames)).toHaveLength(1)
      expect(toListItems(txs, darlingViewer, categoryNames)).toHaveLength(0)
    })

    it('削除済み取引は常にリストから除外', () => {
      const txs: Transaction[] = [
        {
          kind: 'deleted',
          common: {
            transactionId: 'tx_del' as never,
            ownerUserId: HONEY_ID,
            merchantName: '削除済み',
            amount: 100 as never,
            occurredAt: new Date(),
            importSource: { kind: 'manual', enteredAt: new Date(), enteredByUserId: HONEY_ID },
          },
          deletedAt: new Date(),
          deletionReason: 'user_deleted',
        },
      ]
      expect(toListItems(txs, honeyViewer, categoryNames)).toHaveLength(0)
      expect(toListItems(txs, darlingViewer, categoryNames)).toHaveLength(0)
    })
  })
})
