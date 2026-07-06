import { describe, it, expect } from 'vitest'
import { AmazonProductKeyLearningRuleSchema } from '../../../src/auto-classification/aggregates/AmazonProductKeyLearningRule'

describe('AmazonProductKeyLearningRule 集約', () => {
  it('3 軸の学習済み/未学習混在で parse 成功（T-2）', () => {
    expect(() =>
      AmazonProductKeyLearningRuleSchema.parse({
        userId: 'user_honey' as never,
        amazonProductKey: '本' as never,
        categoryRef: { kind: 'learned', categoryId: '01CAT000000000000000000001' as never },
        expenseClassRef: { kind: 'unlearned' },
        expenseTypeRef: { kind: 'learned', expenseTypeId: '01EXP000000000000000000001' as never },
        lastUpdatedAt: new Date(),
      }),
    ).not.toThrow()
  })

  it('Amazon商品キーが空文字なら parse 失敗', () => {
    expect(() =>
      AmazonProductKeyLearningRuleSchema.parse({
        userId: 'user_honey' as never,
        amazonProductKey: '' as never,
        categoryRef: { kind: 'unlearned' },
        expenseClassRef: { kind: 'unlearned' },
        expenseTypeRef: { kind: 'unlearned' },
        lastUpdatedAt: new Date(),
      }),
    ).toThrow()
  })
})
