import { describe, it, expect } from 'vitest'
import { AmazonProductInfoExtractedSchema } from '../../../src/transaction-import/events/AmazonProductInfoExtracted'

const base = {
  eventId: '01EVT000000000000000000001',
  occurredAt: new Date('2026-08-23T00:00:00Z'),
  type: 'AmazonProductInfoExtracted' as const,
  amazonOrderId: '250-1234567-1234567',
  userId: 'user_darling',
}

describe('AmazonProductInfoExtracted イベント', () => {
  it('注文から取り出した商品名をそのまま運ぶ', () => {
    const parsed = AmazonProductInfoExtractedSchema.parse({
      ...base,
      productNames: ['ドメイン駆動設計', '珈琲'],
    })
    expect(parsed.productNames).toEqual(['ドメイン駆動設計', '珈琲'])
  })

  it('商品名に空文字が混ざっていたら parse 失敗（名前の無い商品は運ばない）', () => {
    expect(() => AmazonProductInfoExtractedSchema.parse({ ...base, productNames: [''] })).toThrow()
  })

  it('取り下げ前の商品キー形式（productKeys）では parse 失敗（#572）', () => {
    expect(() => AmazonProductInfoExtractedSchema.parse({ ...base, productKeys: ['本'] })).toThrow()
  })
})
