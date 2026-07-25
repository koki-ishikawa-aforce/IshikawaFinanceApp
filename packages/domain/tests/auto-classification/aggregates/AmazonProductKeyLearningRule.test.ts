import { describe, it, expect } from 'vitest'
import {
  AmazonProductKeyLearningRuleSchema,
  applicableAmazonProductKeyClassification,
  reflectAmazonProductKeyManualClassification,
  type AmazonProductKeyLearningRule,
} from '../../../src/auto-classification/aggregates/AmazonProductKeyLearningRule'
import { AmazonProductKeySchema } from '../../../src/shared/value-objects/AmazonProductKey'
import { CategoryIdSchema, ExpenseTypeIdSchema, UserIdSchema } from '../../../src/shared/ids'
import { InvariantViolationError } from '../../../src/shared/errors'

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

describe('reflectAmazonProductKeyManualClassification（手動修正の学習反映・X-1）', () => {
  const userId = UserIdSchema.parse('user_honey')
  const amazonProductKey = AmazonProductKeySchema.parse('本')
  const categoryId = CategoryIdSchema.parse('01CAT000000000000000000001')
  const expenseTypeId = ExpenseTypeIdSchema.parse('01EXP000000000000000000001')
  const at = new Date('2026-07-25T00:00:00Z')

  it('未学習（existing=null）から 3 軸を学習し、商品キー別に updated を返す', () => {
    const result = reflectAmazonProductKeyManualClassification(
      null,
      userId,
      amazonProductKey,
      { categoryId, expenseClass: 'business_expense', expenseTypeId },
      at,
    )
    expect(result.kind).toBe('updated')
    if (result.kind !== 'updated') return
    expect(result.updatedAxes.sort()).toEqual(['category', 'expense_class', 'expense_type'])
    expect(result.rule.amazonProductKey).toBe(amazonProductKey)
    expect(result.rule.categoryRef).toEqual({ kind: 'learned', categoryId })
    expect(result.rule.expenseClassRef).toEqual({
      kind: 'learned',
      expenseClass: 'business_expense',
    })
    expect(result.rule.expenseTypeRef).toEqual({ kind: 'learned', expenseTypeId })
  })

  it('冪等: 同一分類の再反映は unchanged（同一イベント再配信で二重付け替えしない）', () => {
    const learned = reflectAmazonProductKeyManualClassification(
      null,
      userId,
      amazonProductKey,
      { categoryId, expenseClass: 'household' },
      at,
    )
    expect(learned.kind).toBe('updated')
    if (learned.kind !== 'updated') return
    const again = reflectAmazonProductKeyManualClassification(
      learned.rule,
      userId,
      amazonProductKey,
      { categoryId, expenseClass: 'household' },
      new Date('2026-07-26T00:00:00Z'),
    )
    expect(again.kind).toBe('unchanged')
  })

  it('T-2: 値が変わった軸だけ更新軸として報告し、経費種別軸は保持する', () => {
    const existing: AmazonProductKeyLearningRule = {
      userId,
      amazonProductKey,
      categoryRef: { kind: 'learned', categoryId },
      expenseClassRef: { kind: 'learned', expenseClass: 'business_expense' },
      expenseTypeRef: { kind: 'learned', expenseTypeId },
      lastUpdatedAt: at,
    }
    // カテゴリは同一のまま費用区分を経費以外へ変える → 経費種別軸は触らない（保持）
    const result = reflectAmazonProductKeyManualClassification(
      existing,
      userId,
      amazonProductKey,
      { categoryId, expenseClass: 'household' },
      new Date('2026-07-26T00:00:00Z'),
    )
    expect(result.kind).toBe('updated')
    if (result.kind !== 'updated') return
    expect(result.updatedAxes).toEqual(['expense_class'])
    expect(result.rule.expenseTypeRef).toEqual({ kind: 'learned', expenseTypeId })
  })

  it('学習済みルールから適用可能な分類を導出できる（以降同一商品キーで自動分類される）', () => {
    const learned = reflectAmazonProductKeyManualClassification(
      null,
      userId,
      amazonProductKey,
      { categoryId, expenseClass: 'business_expense', expenseTypeId },
      at,
    )
    if (learned.kind !== 'updated') throw new Error('setup failed')
    const applied = applicableAmazonProductKeyClassification(learned.rule)
    expect(applied).toEqual({ categoryId, expenseClass: 'business_expense', expenseTypeId })
  })

  it('未学習軸が残るルールは適用不可（T-2）', () => {
    const partial: AmazonProductKeyLearningRule = {
      userId,
      amazonProductKey,
      categoryRef: { kind: 'learned', categoryId },
      expenseClassRef: { kind: 'unlearned' },
      expenseTypeRef: { kind: 'unlearned' },
      lastUpdatedAt: at,
    }
    expect(() => applicableAmazonProductKeyClassification(partial)).toThrow(InvariantViolationError)
  })
})
