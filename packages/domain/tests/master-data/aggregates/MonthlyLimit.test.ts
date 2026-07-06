import { describe, it, expect } from 'vitest'
import { MonthlyLimitSchema } from '../../../src/master-data/aggregates/MonthlyLimit'

const base = {
  monthlyLimitId: 'lim_001' as never,
  userId: 'user_honey' as never,
  expenseTypeId: 'exp_gym' as never,
  effectiveFrom: new Date(),
}

describe('MonthlyLimit 集約', () => {
  it('上限あり月次上限は parse 成功', () => {
    expect(() =>
      MonthlyLimitSchema.parse({
        ...base,
        kind: 'capped',
        capAmount: 10000 as never,
        changeHistory: [],
      }),
    ).not.toThrow()
  })

  it('無制限月次上限は parse 成功', () => {
    expect(() => MonthlyLimitSchema.parse({ ...base, kind: 'unlimited' })).not.toThrow()
  })

  it('無制限が上限金額を持つと parse 失敗（論点15: 構造分離、マジックナンバー不使用）', () => {
    expect(() =>
      MonthlyLimitSchema.parse({ ...base, kind: 'unlimited', capAmount: 10000 }),
    ).toThrow()
  })

  it('上限ありで上限金額欠落なら parse 失敗', () => {
    expect(() => MonthlyLimitSchema.parse({ ...base, kind: 'capped', changeHistory: [] })).toThrow()
  })
})
