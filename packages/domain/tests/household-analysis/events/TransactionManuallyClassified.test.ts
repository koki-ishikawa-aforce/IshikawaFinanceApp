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
  it('確定分類と加盟店名が揃っていれば parse 成功', () => {
    const parsed = TransactionManuallyClassifiedSchema.parse(base)
    expect(parsed.merchantName).toBe('スーパーA')
    expect(parsed.confirmedClassification.expenseClass).toBe('household')
  })

  it('加盟店名が空文字なら parse 失敗（下流の学習がルールを引けないため）', () => {
    expect(() => TransactionManuallyClassifiedSchema.parse({ ...base, merchantName: '' })).toThrow()
  })

  it('経費の確定分類に経費種別ID が無ければ parse 失敗', () => {
    expect(() =>
      TransactionManuallyClassifiedSchema.parse({
        ...base,
        confirmedClassification: {
          categoryId: '01CAT000000000000000000001',
          expenseClass: 'business_expense',
        },
      }),
    ).toThrow()
  })

  it('経費の確定分類は経費種別ID を伴えば parse 成功し、そのまま運ばれる', () => {
    const parsed = TransactionManuallyClassifiedSchema.parse({
      ...base,
      confirmedClassification: {
        categoryId: '01CAT000000000000000000001',
        expenseClass: 'business_expense',
        expenseTypeId: '01EXP000000000000000000001',
      },
    })
    expect(parsed.confirmedClassification.expenseTypeId).toBe('01EXP000000000000000000001')
  })

  // スキーマへの再追加を検出する回帰ガード。zod の既定（未知キーは strip）に依るため、
  // 主張は「拒否する」ではなく「載らない」であることに注意する
  it('Amazon 商品キーを渡してもイベントには載らない（X-1 取り下げ、#572）', () => {
    const parsed = TransactionManuallyClassifiedSchema.parse({
      ...base,
      merchantName: 'AMAZON.CO.JP',
      amazonProductKey: '本',
    })
    expect(parsed).not.toHaveProperty('amazonProductKey')
  })
})
