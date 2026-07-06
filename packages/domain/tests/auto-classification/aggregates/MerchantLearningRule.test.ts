import { describe, it, expect } from 'vitest'
import {
  MerchantLearningRuleSchema,
  disableMerchantLearning,
  reenableMerchantLearning,
  type ActiveMerchantLearningRule,
  type DisabledMerchantLearningRule,
} from '../../../src/auto-classification/aggregates/MerchantLearningRule'

const activeRule = {
  kind: 'active',
  common: { userId: 'user_honey' as never, merchantName: 'スターバックス' },
  categoryRef: { kind: 'learned', categoryId: 'cat_001' as never },
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
