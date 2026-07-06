import { describe, it, expect } from 'vitest'
import { ExpenseTypeAccumulationSchema } from '../../../src/expense-settlement/value-objects/ExpenseTypeAccumulation'

const unlimitedBase = {
  kind: 'unlimited',
  accumulationId: '01ACC000000000000000000001' as never,
  expenseTypeId: '01EXP000000000000000000001' as never,
  userId: 'user_honey' as never,
  currentTotal: 5000 as never,
  transactionRefs: [],
}

function partialRef(amount: number, expense: number, personal: number) {
  return {
    transactionId: '01TX0000000000000000000001' as never,
    occurredAt: new Date(),
    amount: amount as never,
    allocation: {
      kind: 'partial',
      expenseAllocatedAmount: expense as never,
      personalAllocatedAmount: personal as never,
      childTransactionId: '01CHD000000000000000000001' as never,
    },
  }
}

describe('ExpenseTypeAccumulation 値オブジェクト', () => {
  it('無制限経費種別累計は parse 成功', () => {
    expect(() => ExpenseTypeAccumulationSchema.parse(unlimitedBase)).not.toThrow()
  })

  it('無制限が上限金額を持つと parse 失敗（論点15: 構造分離）', () => {
    expect(() =>
      ExpenseTypeAccumulationSchema.parse({ ...unlimitedBase, monthlyCap: 10000 }),
    ).toThrow()
  })

  it('無制限が上限到達状態を持つと parse 失敗（論点15）', () => {
    expect(() =>
      ExpenseTypeAccumulationSchema.parse({
        ...unlimitedBase,
        capReached: { kind: 'not_reached' },
      }),
    ).toThrow()
  })

  it('上限あり経費種別累計は上限金額が必須（欠落で parse 失敗）', () => {
    expect(() =>
      ExpenseTypeAccumulationSchema.parse({
        kind: 'capped',
        accumulationId: '01ACC000000000000000000001' as never,
        expenseTypeId: '01EXP000000000000000000001' as never,
        userId: 'user_honey' as never,
        currentTotal: 5000 as never,
        capReached: { kind: 'not_reached' },
        transactionRefs: [],
      }),
    ).toThrow()
  })

  it('部分経費充当: 経費充当分 + 個人充当分 = 取引金額なら parse 成功', () => {
    expect(() =>
      ExpenseTypeAccumulationSchema.parse({
        ...unlimitedBase,
        currentTotal: 3000 as never,
        transactionRefs: [partialRef(5000, 3000, 2000)],
      }),
    ).not.toThrow()
  })

  it('部分経費充当: 充当分合計が取引金額と一致しないなら parse 失敗', () => {
    expect(() =>
      ExpenseTypeAccumulationSchema.parse({
        ...unlimitedBase,
        currentTotal: 300 as never,
        transactionRefs: [partialRef(10000, 300, 100)],
      }),
    ).toThrow()
  })

  it('部分経費充当: 経費充当分が負値なら parse 失敗', () => {
    expect(() =>
      ExpenseTypeAccumulationSchema.parse({
        ...unlimitedBase,
        currentTotal: -500 as never,
        transactionRefs: [partialRef(1000, -500, 1500)],
      }),
    ).toThrow()
  })

  it('部分経費充当: 個人充当分が 0 なら parse 失敗（分割は個人按分を伴う）', () => {
    expect(() =>
      ExpenseTypeAccumulationSchema.parse({
        ...unlimitedBase,
        currentTotal: 1000 as never,
        transactionRefs: [partialRef(1000, 1000, 0)],
      }),
    ).toThrow()
  })
})
