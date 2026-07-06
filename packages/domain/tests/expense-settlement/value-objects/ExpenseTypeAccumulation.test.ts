import { describe, it, expect } from 'vitest'
import { ExpenseTypeAccumulationSchema } from '../../../src/expense-settlement/value-objects/ExpenseTypeAccumulation'

const unlimitedBase = {
  kind: 'unlimited',
  accumulationId: 'acc_001' as never,
  expenseTypeId: 'exp_001' as never,
  userId: 'user_honey' as never,
  currentTotal: 5000 as never,
  transactionRefs: [],
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
        accumulationId: 'acc_001' as never,
        expenseTypeId: 'exp_001' as never,
        userId: 'user_honey' as never,
        currentTotal: 5000 as never,
        capReached: { kind: 'not_reached' },
        transactionRefs: [],
      }),
    ).toThrow()
  })
})
