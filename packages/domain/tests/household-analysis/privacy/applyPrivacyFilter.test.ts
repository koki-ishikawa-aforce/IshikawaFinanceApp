import { describe, it, expect } from 'vitest'
import { toListItems } from '../../../src/household-analysis/privacy/applyPrivacyFilter'
import type { ViewerContext } from '../../../src/household-analysis/privacy/ViewerContext'
import type {
  Transaction,
  ClassifiedTransaction,
} from '../../../src/household-analysis/aggregates/Transaction'
import { testUlid } from '../../helpers/ids'

const HONEY_ID = 'user_honey' as never
const DARLING_ID = 'user_darling' as never

/** (owner, expenseClass) ごとに一意な ULID サフィックスを割り当てる */
const EXPENSE_CLASS_CODE = {
  household: '1',
  personal_honey: '2',
  personal_darling: '3',
  business_expense: '4',
} as const

const honeyViewer: ViewerContext = { viewerId: HONEY_ID, role: 'honey' }
const darlingViewer: ViewerContext = { viewerId: DARLING_ID, role: 'darling' }

function makeClassified(
  ownerId: string,
  expenseClass: 'household' | 'personal_honey' | 'personal_darling' | 'business_expense',
): ClassifiedTransaction {
  const expenseTypeRef =
    expenseClass === 'business_expense'
      ? { kind: 'business' as const, expenseTypeId: '01EXP000000000000000000001' as never }
      : { kind: 'non_business' as const }
  return {
    kind: 'classified',
    common: {
      transactionId: testUlid(
        '01TX',
        `${ownerId === 'user_honey' ? 'H' : 'D'}${EXPENSE_CLASS_CODE[expenseClass]}`,
      ) as never,
      ownerUserId: ownerId as never,
      merchantName: 'スーパーA',
      amount: 1000 as never,
      occurredAt: new Date(),
      importSource: { kind: 'manual', enteredAt: new Date(), enteredByUserId: ownerId as never },
    },
    details: {
      categoryId: '01CAT000000000000000000001' as never,
      expenseClass,
      expenseTypeRef,
      basis: { kind: 'user_manual', modifiedByUserId: ownerId as never, modifiedAt: new Date() },
    },
  }
}

describe('applyPrivacyFilter', () => {
  const categoryNames = new Map<string, string>([['01CAT000000000000000000001', '食費']])

  describe('toListItems（プライバシー完全強制 A①）', () => {
    it('経費(会社) で他人の取引はリストから除外', () => {
      const txs: Transaction[] = [makeClassified(HONEY_ID, 'business_expense')]
      expect(toListItems(txs, darlingViewer, categoryNames)).toHaveLength(0)
    })

    it('経費(会社) で本人の取引はリストに明細付きで含まれる', () => {
      const txs: Transaction[] = [makeClassified(HONEY_ID, 'business_expense')]
      const items = toListItems(txs, honeyViewer, categoryNames)
      expect(items).toHaveLength(1)
      expect(items[0]?.merchantName).toBe('スーパーA')
      expect(items[0]?.amount).toBe(1000)
    })

    it('個人(本人) の取引は配偶者のリストから完全除外（伏せ字行を残さない）', () => {
      const txs: Transaction[] = [makeClassified(HONEY_ID, 'personal_honey')]
      const items = toListItems(txs, darlingViewer, categoryNames)
      expect(items).toHaveLength(0)
    })

    it('個人(本人) の取引は本人には明細付きで可視', () => {
      const txs: Transaction[] = [makeClassified(HONEY_ID, 'personal_honey')]
      const items = toListItems(txs, honeyViewer, categoryNames)
      expect(items).toHaveLength(1)
      expect(items[0]?.merchantName).toBe('スーパーA')
      expect(items[0]?.amount).toBe(1000)
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
            transactionId: '01TX0000000000000000000901' as never,
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
            transactionId: '01TX0000000000000000000902' as never,
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

    it('返される明細に金額 null / 加盟店名 null の伏せ字行が存在しない', () => {
      const txs: Transaction[] = [
        makeClassified(HONEY_ID, 'household'),
        makeClassified(HONEY_ID, 'personal_honey'),
        makeClassified(DARLING_ID, 'personal_darling'),
        makeClassified(HONEY_ID, 'business_expense'),
      ]
      for (const viewer of [honeyViewer, darlingViewer]) {
        const items = toListItems(txs, viewer, categoryNames)
        for (const item of items) {
          expect(item.merchantName).not.toBeNull()
          expect(item.amount).not.toBeNull()
        }
      }
    })
  })
})
