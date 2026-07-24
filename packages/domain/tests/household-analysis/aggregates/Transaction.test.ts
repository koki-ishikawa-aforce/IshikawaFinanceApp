import { describe, it, expect } from 'vitest'
import {
  TransactionSchema,
  classify,
  createClassifiedTransaction,
  type CommonTransactionAttrs,
  type ClassifiedDetails,
  type UnclassifiedTransaction,
} from '../../../src/household-analysis/aggregates/Transaction'
import { InvariantViolationError } from '../../../src/shared/errors'

const validCommon: CommonTransactionAttrs = {
  transactionId: '01TX0000000000000000000001' as never,
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
            categoryId: '01CAT000000000000000000001' as never,
            expenseClass: 'business_expense',
            expenseTypeRef: { kind: 'non_business' },
            basis: {
              kind: 'user_manual',
              modifiedByUserId: 'user_honey' as never,
              modifiedAt: new Date(),
            },
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
            categoryId: '01CAT000000000000000000001' as never,
            expenseClass: 'household',
            expenseTypeRef: {
              kind: 'business',
              expenseTypeId: '01EXP000000000000000000001' as never,
            },
            basis: {
              kind: 'user_manual',
              modifiedByUserId: 'user_honey' as never,
              modifiedAt: new Date(),
            },
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
            categoryId: '01CAT000000000000000000001' as never,
            expenseClass: 'business_expense',
            expenseTypeRef: {
              kind: 'business',
              expenseTypeId: '01EXP000000000000000000001' as never,
            },
            basis: {
              kind: 'user_manual',
              modifiedByUserId: 'user_honey' as never,
              modifiedAt: new Date(),
            },
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
            categoryId: '01CAT000000000000000000001' as never,
            expenseClass: 'household',
            expenseTypeRef: { kind: 'non_business' },
            basis: {
              kind: 'merchant_rule',
              merchantName: 'スーパーA',
              ruleLastUpdatedAt: new Date(),
            },
          },
        }),
      ).not.toThrow()
    })
  })

  describe('個人費用区分と所有者ロールの整合ガード', () => {
    const unclassifiedHoney: UnclassifiedTransaction = TransactionSchema.parse({
      kind: 'unclassified',
      common: validCommon,
      reason: 'merchant_rule_unlearned',
      defaultExpenseClass: 'personal_honey',
    }) as UnclassifiedTransaction

    const makeDetails = (expenseClass: string): ClassifiedDetails =>
      ({
        categoryId: '01CAT000000000000000000001',
        expenseClass,
        expenseTypeRef:
          expenseClass === 'business_expense'
            ? { kind: 'business', expenseTypeId: '01EXP000000000000000000001' }
            : { kind: 'non_business' },
        basis: { kind: 'user_manual', modifiedByUserId: 'user_honey', modifiedAt: new Date() },
      }) as never

    describe('classify()', () => {
      it('所有者ロールと一致する個人費用区分なら成功', () => {
        expect(() =>
          classify(unclassifiedHoney, makeDetails('personal_honey'), 'honey'),
        ).not.toThrow()
      })

      it('相手の個人費用区分なら InvariantViolationError', () => {
        expect(() => classify(unclassifiedHoney, makeDetails('personal_darling'), 'honey')).toThrow(
          InvariantViolationError,
        )
      })

      it('世帯・経費(会社) は所有者ロールに縛られない', () => {
        expect(() => classify(unclassifiedHoney, makeDetails('household'), 'honey')).not.toThrow()
        expect(() =>
          classify(unclassifiedHoney, makeDetails('business_expense'), 'honey'),
        ).not.toThrow()
      })
    })

    describe('createClassifiedTransaction()', () => {
      it('所有者ロールと一致する個人費用区分なら成功', () => {
        expect(() =>
          createClassifiedTransaction(validCommon, makeDetails('personal_honey'), 'honey'),
        ).not.toThrow()
      })

      it('相手の個人費用区分なら InvariantViolationError', () => {
        expect(() =>
          createClassifiedTransaction(validCommon, makeDetails('personal_darling'), 'honey'),
        ).toThrow(InvariantViolationError)
      })

      it('世帯・経費(会社) は所有者ロールに縛られない', () => {
        expect(() =>
          createClassifiedTransaction(validCommon, makeDetails('household'), 'darling'),
        ).not.toThrow()
        expect(() =>
          createClassifiedTransaction(validCommon, makeDetails('business_expense'), 'darling'),
        ).not.toThrow()
      })
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
