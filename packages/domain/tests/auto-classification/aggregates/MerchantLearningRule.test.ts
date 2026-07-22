import { describe, it, expect } from 'vitest'
import {
  ManualClassificationSchema,
  MerchantLearningRuleSchema,
  disableMerchantLearning,
  reenableMerchantLearning,
  reflectManualClassification,
  resolveActiveRuleClassification,
  type ActiveMerchantLearningRule,
  type DisabledMerchantLearningRule,
} from '../../../src/auto-classification/aggregates/MerchantLearningRule'
import { InvariantViolationError } from '../../../src/shared/errors/DomainError'

const activeRule = {
  kind: 'active',
  common: { userId: 'user_honey' as never, merchantName: 'スターバックス' },
  categoryRef: { kind: 'learned', categoryId: '01CAT000000000000000000001' as never },
  expenseClassRef: { kind: 'learned', expenseClass: 'household' },
  expenseTypeRef: { kind: 'unlearned' },
  lastUpdatedAt: new Date(),
}

describe('MerchantLearningRule 集約', () => {
  it('有効ルール（T-2 フィールド独立の学習済み/未学習混在）は parse 成功', () => {
    expect(() => MerchantLearningRuleSchema.parse(activeRule)).not.toThrow()
  })

  it('学習無効化ルールは parse 成功', () => {
    expect(() =>
      MerchantLearningRuleSchema.parse({
        kind: 'disabled',
        common: { userId: 'user_honey' as never, merchantName: 'スターバックス' },
        disabledAt: new Date(),
      }),
    ).not.toThrow()
  })

  it('AMAZON.CO.JP は加盟店学習の対象外（X-1）なので有効ルールで parse 失敗', () => {
    expect(() =>
      MerchantLearningRuleSchema.parse({
        ...activeRule,
        common: { userId: 'user_honey' as never, merchantName: 'AMAZON.CO.JP' },
      }),
    ).toThrow()
  })

  it('AMAZON.CO.JP は学習無効化ルールとしても parse 失敗（X-1）', () => {
    expect(() =>
      MerchantLearningRuleSchema.parse({
        kind: 'disabled',
        common: { userId: 'user_honey' as never, merchantName: 'AMAZON.CO.JP' },
        disabledAt: new Date(),
      }),
    ).toThrow()
  })

  it('表記ゆれ（大文字小文字・前後空白）の Amazon も parse 失敗（X-1 防御的正規化）', () => {
    for (const merchantName of ['Amazon.co.jp', 'AMAZON.CO.JP ', 'amazon.co.jp']) {
      expect(() =>
        MerchantLearningRuleSchema.parse({
          ...activeRule,
          common: { userId: 'user_honey' as never, merchantName },
        }),
      ).toThrow()
    }
  })

  it('disableMerchantLearning: 有効 → 学習無効化', () => {
    const active = MerchantLearningRuleSchema.parse(activeRule) as ActiveMerchantLearningRule
    const disabled = disableMerchantLearning(active, new Date())
    expect(disabled.kind).toBe('disabled')
    expect(disabled.common.merchantName).toBe('スターバックス')
  })

  it('reenableMerchantLearning: 再有効化後は全軸が未学習に戻る', () => {
    const disabled = MerchantLearningRuleSchema.parse({
      kind: 'disabled',
      common: { userId: 'user_honey' as never, merchantName: 'スターバックス' },
      disabledAt: new Date(),
    }) as DisabledMerchantLearningRule
    const reenabled = reenableMerchantLearning(disabled, new Date())
    expect(reenabled.kind).toBe('active')
    expect(reenabled.categoryRef.kind).toBe('unlearned')
    expect(reenabled.expenseClassRef.kind).toBe('unlearned')
    expect(reenabled.expenseTypeRef.kind).toBe('unlearned')
  })
})

describe('reflectManualClassification（手動修正を学習に反映する、08b §2）', () => {
  const userId = 'user_honey' as never
  const merchantName = 'スターバックス'
  const categoryA = '01CAT000000000000000000001' as never
  const categoryB = '01CAT000000000000000000002' as never
  const expenseTypeX = '01EXT000000000000000000001' as never
  const at = new Date('2026-07-01T00:00:00Z')

  it('ルール未登録の加盟店への手動分類は全軸を学習した新規ルールを生む', () => {
    const result = reflectManualClassification(
      null,
      userId,
      merchantName,
      { categoryId: categoryA, expenseClass: 'household' },
      at,
    )
    expect(result.kind).toBe('updated')
    if (result.kind !== 'updated') return
    expect(result.updatedAxes).toEqual(['category', 'expense_class'])
    expect(result.rule.categoryRef).toEqual({ kind: 'learned', categoryId: categoryA })
    expect(result.rule.expenseClassRef).toEqual({ kind: 'learned', expenseClass: 'household' })
    expect(result.rule.expenseTypeRef).toEqual({ kind: 'unlearned' })
    expect(result.rule.lastUpdatedAt).toEqual(at)
  })

  it('経費（business_expense）への分類では経費種別軸も学習される', () => {
    const result = reflectManualClassification(
      null,
      userId,
      merchantName,
      { categoryId: categoryA, expenseClass: 'business_expense', expenseTypeId: expenseTypeX },
      at,
    )
    expect(result.kind).toBe('updated')
    if (result.kind !== 'updated') return
    expect(result.updatedAxes).toEqual(['category', 'expense_class', 'expense_type'])
    expect(result.rule.expenseTypeRef).toEqual({ kind: 'learned', expenseTypeId: expenseTypeX })
  })

  it('T-2: 値が変わった軸のみ更新軸として報告される（カテゴリのみ修正）', () => {
    const existing = MerchantLearningRuleSchema.parse({
      kind: 'active',
      common: { userId, merchantName },
      categoryRef: { kind: 'learned', categoryId: categoryA },
      expenseClassRef: { kind: 'learned', expenseClass: 'household' },
      expenseTypeRef: { kind: 'unlearned' },
      lastUpdatedAt: new Date('2026-06-01T00:00:00Z'),
    })
    const result = reflectManualClassification(
      existing,
      userId,
      merchantName,
      { categoryId: categoryB, expenseClass: 'household' },
      at,
    )
    expect(result.kind).toBe('updated')
    if (result.kind !== 'updated') return
    expect(result.updatedAxes).toEqual(['category'])
    expect(result.rule.categoryRef).toEqual({ kind: 'learned', categoryId: categoryB })
    expect(result.rule.expenseClassRef).toEqual({ kind: 'learned', expenseClass: 'household' })
    expect(result.rule.lastUpdatedAt).toEqual(at)
  })

  it('T-2: 経費以外への修正では学習済み経費種別軸を保持する（軸独立）', () => {
    const existing = MerchantLearningRuleSchema.parse({
      kind: 'active',
      common: { userId, merchantName },
      categoryRef: { kind: 'learned', categoryId: categoryA },
      expenseClassRef: { kind: 'learned', expenseClass: 'business_expense' },
      expenseTypeRef: { kind: 'learned', expenseTypeId: expenseTypeX },
      lastUpdatedAt: new Date('2026-06-01T00:00:00Z'),
    })
    const result = reflectManualClassification(
      existing,
      userId,
      merchantName,
      { categoryId: categoryA, expenseClass: 'personal_honey' },
      at,
    )
    expect(result.kind).toBe('updated')
    if (result.kind !== 'updated') return
    expect(result.updatedAxes).toEqual(['expense_class'])
    expect(result.rule.expenseTypeRef).toEqual({ kind: 'learned', expenseTypeId: expenseTypeX })
  })

  it('全軸が既存ルールと同値なら unchanged（保存不要）', () => {
    const existing = MerchantLearningRuleSchema.parse({
      kind: 'active',
      common: { userId, merchantName },
      categoryRef: { kind: 'learned', categoryId: categoryA },
      expenseClassRef: { kind: 'learned', expenseClass: 'household' },
      expenseTypeRef: { kind: 'unlearned' },
      lastUpdatedAt: new Date('2026-06-01T00:00:00Z'),
    })
    const result = reflectManualClassification(
      existing,
      userId,
      merchantName,
      { categoryId: categoryA, expenseClass: 'household' },
      at,
    )
    expect(result).toEqual({ kind: 'unchanged' })
  })

  it('X-1: AMAZON.CO.JP（表記ゆれ含む）は学習対象外として skip される', () => {
    for (const name of ['AMAZON.CO.JP', 'Amazon.co.jp', ' amazon.co.jp ']) {
      const result = reflectManualClassification(
        null,
        userId,
        name,
        { categoryId: categoryA, expenseClass: 'household' },
        at,
      )
      expect(result).toEqual({ kind: 'skipped', reason: 'amazon_merchant' })
    }
  })

  it('M-1: 学習無効化中の加盟店は学習しない', () => {
    const disabled = MerchantLearningRuleSchema.parse({
      kind: 'disabled',
      common: { userId, merchantName },
      disabledAt: new Date('2026-06-01T00:00:00Z'),
    })
    const result = reflectManualClassification(
      disabled,
      userId,
      merchantName,
      { categoryId: categoryA, expenseClass: 'household' },
      at,
    )
    expect(result).toEqual({ kind: 'skipped', reason: 'learning_disabled' })
  })

  it('C9: 修正後分類は経費 ⇒ 経費種別ID 必須（弱い版の重複を持たない）', () => {
    expect(
      ManualClassificationSchema.safeParse({
        categoryId: categoryA,
        expenseClass: 'business_expense',
      }).success,
    ).toBe(false)
    expect(
      ManualClassificationSchema.safeParse({
        categoryId: categoryA,
        expenseClass: 'business_expense',
        expenseTypeId: expenseTypeX,
      }).success,
    ).toBe(true)
    expect(
      ManualClassificationSchema.safeParse({
        categoryId: categoryA,
        expenseClass: 'household',
      }).success,
    ).toBe(true)
  })
})

describe('resolveActiveRuleClassification（学習済みルール → 確定分類の素性、08b §2 遡及適用の前提）', () => {
  const merchantName = 'スターバックス'
  const categoryA = '01CAT000000000000000000001' as never
  const expenseTypeX = '01EXT000000000000000000001' as never

  function activeRuleWith(overrides: Record<string, unknown>): ActiveMerchantLearningRule {
    return MerchantLearningRuleSchema.parse({
      kind: 'active',
      common: { userId: 'user_honey' as never, merchantName },
      categoryRef: { kind: 'learned', categoryId: categoryA },
      expenseClassRef: { kind: 'learned', expenseClass: 'household' },
      expenseTypeRef: { kind: 'unlearned' },
      lastUpdatedAt: new Date(),
      ...overrides,
    }) as ActiveMerchantLearningRule
  }

  it('全軸学習済み（非経費）は expenseTypeId なしの素性を返す', () => {
    const result = resolveActiveRuleClassification(activeRuleWith({}))
    expect(result).toEqual({ categoryId: categoryA, expenseClass: 'household' })
  })

  it('経費(会社) は expenseTypeId を含む素性を返す', () => {
    const result = resolveActiveRuleClassification(
      activeRuleWith({
        expenseClassRef: { kind: 'learned', expenseClass: 'business_expense' },
        expenseTypeRef: { kind: 'learned', expenseTypeId: expenseTypeX },
      }),
    )
    expect(result).toEqual({
      categoryId: categoryA,
      expenseClass: 'business_expense',
      expenseTypeId: expenseTypeX,
    })
  })

  it('未学習軸が残るルールは適用不可（InvariantViolationError）', () => {
    expect(() =>
      resolveActiveRuleClassification(activeRuleWith({ categoryRef: { kind: 'unlearned' } })),
    ).toThrow(InvariantViolationError)
  })

  it('経費(会社) で経費種別が未学習なら適用不可（InvariantViolationError）', () => {
    expect(() =>
      resolveActiveRuleClassification(
        activeRuleWith({
          expenseClassRef: { kind: 'learned', expenseClass: 'business_expense' },
          expenseTypeRef: { kind: 'unlearned' },
        }),
      ),
    ).toThrow(InvariantViolationError)
  })
})
