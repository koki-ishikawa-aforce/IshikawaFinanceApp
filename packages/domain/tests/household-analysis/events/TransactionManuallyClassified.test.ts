import { describe, it, expect } from 'vitest'
import { TransactionManuallyClassifiedSchema } from '../../../src/household-analysis/events/TransactionManuallyClassified'

const base = {
  eventId: '01EVT000000000000000000001',
  occurredAt: new Date('2026-07-25T00:00:00Z'),
  type: 'TransactionManuallyClassified' as const,
  transactionId: '01TX0000000000000000000001',
  userId: 'user_honey',
  merchantName: 'スーパーA',
  confirmedClassification: {
    categoryId: '01CAT000000000000000000001',
    expenseClass: 'household' as const,
  },
}

describe('TransactionManuallyClassified イベント', () => {
  it('amazonProductKey を省略しても parse 成功（既存購読者を壊さない後方互換）', () => {
    const parsed = TransactionManuallyClassifiedSchema.parse(base)
    expect(parsed.amazonProductKey).toBeUndefined()
  })

  it('amazonProductKey（X-1 商品キー）を optional で運べる', () => {
    const parsed = TransactionManuallyClassifiedSchema.parse({
      ...base,
      merchantName: 'AMAZON.CO.JP',
      amazonProductKey: '本',
    })
    expect(parsed.amazonProductKey).toBe('本')
  })

  it('amazonProductKey が空文字なら parse 失敗（商品キーは非空）', () => {
    expect(() =>
      TransactionManuallyClassifiedSchema.parse({ ...base, amazonProductKey: '' }),
    ).toThrow()
  })
})
