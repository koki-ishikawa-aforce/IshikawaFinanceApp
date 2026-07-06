import { describe, it, expect } from 'vitest'
import { ClassificationResultSchema } from '../../../src/auto-classification/value-objects/ClassificationResult'

const classifiedBase = {
  kind: 'auto_classified',
  transactionId: '01TX0000000000000000000001' as never,
  merchantName: 'スターバックス',
  categoryId: '01CAT000000000000000000001' as never,
  basis: {
    kind: 'merchant_rule',
    merchantName: 'スターバックス',
    ruleLastUpdatedAt: new Date(),
  },
}

describe('ClassificationResult 値オブジェクト', () => {
  it('経費(会社) の自動分類済み取引は appliedExpenseTypeId 必須（無しは parse 失敗）', () => {
    expect(() =>
      ClassificationResultSchema.parse({
        ...classifiedBase,
        expenseClass: 'business_expense',
      }),
    ).toThrow()
  })

  it('経費(会社) + appliedExpenseTypeId あり は parse 成功', () => {
    expect(() =>
      ClassificationResultSchema.parse({
        ...classifiedBase,
        expenseClass: 'business_expense',
        appliedExpenseTypeId: '01EXP000000000000000000001' as never,
      }),
    ).not.toThrow()
  })

  it('経費(会社) 以外で appliedExpenseTypeId を持つと parse 失敗', () => {
    expect(() =>
      ClassificationResultSchema.parse({
        ...classifiedBase,
        expenseClass: 'household',
        appliedExpenseTypeId: '01EXP000000000000000000001' as never,
      }),
    ).toThrow()
  })

  it('学習無効化適用の未分類取引（M-1）は parse 成功', () => {
    expect(() =>
      ClassificationResultSchema.parse({
        kind: 'unclassified',
        transactionId: '01TX0000000000000000000001' as never,
        merchantName: 'スターバックス',
        reason: 'learning_disabled',
        defaultExpenseClass: 'personal_darling',
      }),
    ).not.toThrow()
  })
})
