import { describe, it, expect } from 'vitest'
import { ProratedChildTransactionSchema } from '../../../src/expense-settlement/aggregates/ProratedChildTransaction'

const base = {
  childTransactionId: '01CHD000000000000000000001' as never,
  parentTransactionId: '01TX0000000000000000000001' as never,
  userId: 'user_honey' as never,
  personalExpenseClass: 'personal_honey',
  derivedAt: new Date(),
  prorationBasis: {
    kind: 'cap_excess_fifo',
    monthlyExpenseCycleId: '01CYC000000000000000000001' as never,
    proratedAt: new Date(),
    capRemainderAtExcess: 2000 as never,
  },
}

describe('ProratedChildTransaction 集約', () => {
  it('個人充当金額 > 0 なら parse 成功', () => {
    expect(() =>
      ProratedChildTransactionSchema.parse({ ...base, personalAmount: 3000 as never }),
    ).not.toThrow()
  })

  it('個人充当金額 = 0 なら parse 失敗', () => {
    expect(() =>
      ProratedChildTransactionSchema.parse({ ...base, personalAmount: 0 as never }),
    ).toThrow()
  })

  it('個人充当金額が負なら parse 失敗', () => {
    expect(() =>
      ProratedChildTransactionSchema.parse({ ...base, personalAmount: -100 as never }),
    ).toThrow()
  })

  it('経費修正再按分 / 経費削除再按分の按分根拠も parse 成功', () => {
    const recalcBases = ['correction_recalculation', 'deletion_recalculation'] as const
    for (const kind of recalcBases) {
      expect(() =>
        ProratedChildTransactionSchema.parse({
          ...base,
          personalAmount: 1000 as never,
          prorationBasis: {
            kind,
            monthlyExpenseCycleId: '01CYC000000000000000000001' as never,
            causingTransactionId: '01TX0000000000000000000002' as never,
            recalculatedAt: new Date(),
          },
        }),
      ).not.toThrow()
    }
  })

  it('親取引ID欠落は parse 失敗（孤立した按分子取引は不可）', () => {
    const withoutParent: Record<string, unknown> = { ...base, personalAmount: 1000 as never }
    delete withoutParent['parentTransactionId']
    expect(() => ProratedChildTransactionSchema.parse(withoutParent)).toThrow()
  })
})
