import { describe, it, expect } from 'vitest'
import { ClassificationBasisSchema } from '../../../src/shared/value-objects/ClassificationBasis'

describe('ClassificationBasis（分類根拠）', () => {
  it('加盟店ルール根拠を受理する', () => {
    const parsed = ClassificationBasisSchema.parse({
      kind: 'merchant_rule',
      merchantName: 'ライフ 中目黒店',
      ruleLastUpdatedAt: new Date('2026-07-18T04:20:00Z'),
    })
    expect(parsed.kind).toBe('merchant_rule')
  })

  it('ユーザー手動修正根拠を受理する', () => {
    const parsed = ClassificationBasisSchema.parse({
      kind: 'user_manual',
      modifiedByUserId: 'user_honey',
      modifiedAt: new Date('2026-07-18T04:20:00Z'),
    })
    expect(parsed.kind).toBe('user_manual')
  })

  it('CSV取込時一括分類根拠を受理する', () => {
    const parsed = ClassificationBasisSchema.parse({
      kind: 'csv_bulk',
      bulkSessionId: '01HQ8ZKJ9M3N4P5Q6R7S8T9VW0',
      appliedAt: new Date('2026-07-18T04:20:00Z'),
    })
    expect(parsed.kind).toBe('csv_bulk')
  })

  it('Amazon商品キー根拠は受け付けない（X-1 取り下げ、#572）', () => {
    expect(() =>
      ClassificationBasisSchema.parse({
        kind: 'amazon_product_key',
        amazonProductKey: '本',
        ruleLastUpdatedAt: new Date('2026-07-18T04:20:00Z'),
      }),
    ).toThrow()
  })
})
