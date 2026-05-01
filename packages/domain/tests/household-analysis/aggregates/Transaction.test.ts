import { describe, it, expect } from 'vitest'
import {
  TransactionSchema,
  type CommonTransactionAttrs,
} from '../../../src/household-analysis/aggregates/Transaction'

const validCommon: CommonTransactionAttrs = {
  transactionId: 'tx_001' as never,
  ownerUserId: 'user_honey' as never,
  merchantName: 'スーパーA',
  amount: 1500 as never,
  occurredAt: new Date('2026-05-01T12:00:00Z'),
  importSource: { kind: 'manual', enteredAt: new Date(), enteredByUserId: 'user_honey' as never },
}

describe('Transaction 集約', () => {
  describe('未分類取引', () => {
    it('正常な未分類取引を parse できる', () => {
      expect(() =>
        TransactionSchema.parse({
          kind: 'unclassified',
          common: validCommon,
          reason: 'merchant_rule_unlearned',
          defaultExpenseClass: 'personal_honey',
        }),
      ).not.toThrow()
    })

    it('reason が enum 外なら拒否', () => {
      expect(() =>
        TransactionSchema.parse({
          kind: 'unclassified',
          common: validCommon,
          reason: 'unknown_reason',
          defaultExpenseClass: 'personal_honey',
        }),
      ).toThrow()
    })
  })

  describe('分類済み取引（不変条件）', () => {
    it('経費(会社) なら expenseTypeRef.kind = business が必須', () => {
      expect(() =>
        TransactionSchema.parse({
          kind: 'classified',
          common: validCommon,
          details: {
            categoryId: 'cat_001' as never,
            expenseClass: 'business_expense',
            expenseTypeRef: { kind: 'non_business' },
            basis: { kind: 'user_manual', modifiedByUserId: 'user_honey' as never, modifiedAt: new Date() },
          },
        }),
      ).toThrow()
    })

    it('世帯費用に expenseTypeRef.kind = business は NG', () => {
      expect(() =>
        TransactionSchema.parse({
          kind: 'classified',
          common: validCommon,
          details: {
            categoryId: 'cat_001' as never,
            expenseClass: 'household',
            expenseTypeRef: { kind: 'business', expenseTypeId: 'exp_001' as never },
            basis: { kind: 'user_manual', modifiedByUserId: 'user_honey' as never, modifiedAt: new Date() },
          },
        }),
      ).toThrow()
    })

    it('経費(会社) + business expenseTypeRef は OK', () => {
      expect(() =>
        TransactionSchema.parse({
          kind: 'classified',
          common: validCommon,
          details: {
            categoryId: 'cat_001' as never,
            expenseClass: 'business_expense',
            expenseTypeRef: { kind: 'business', expenseTypeId: 'exp_001' as never },
            basis: { kind: 'user_manual', modifiedByUserId: 'user_honey' as never, modifiedAt: new Date() },
          },
        }),
      ).not.toThrow()
    })

    it('世帯費用 + non_business expenseTypeRef は OK', () => {
      expect(() =>
        TransactionSchema.parse({
          kind: 'classified',
          common: validCommon,
          details: {
            categoryId: 'cat_001' as never,
            expenseClass: 'household',
            expenseTypeRef: { kind: 'non_business' },
            basis: { kind: 'merchant_rule', merchantName: 'スーパーA', ruleLastUpdatedAt: new Date() },
          },
        }),
      ).not.toThrow()
    })
  })

  describe('削除済み取引', () => {
    it('正常な削除済み取引を parse できる', () => {
      expect(() =>
        TransactionSchema.parse({
          kind: 'deleted',
          common: validCommon,
          deletedAt: new Date(),
          deletionReason: 'user_deleted',
        }),
      ).not.toThrow()
    })
  })
})
