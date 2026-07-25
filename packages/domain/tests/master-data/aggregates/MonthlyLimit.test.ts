import { describe, it, expect } from 'vitest'
import {
  MonthlyLimitSchema,
  defaultSeedLimitFor,
  seedMonthlyLimit,
} from '../../../src/master-data/aggregates/MonthlyLimit'
import { testUlid } from '../../helpers/ids'

const base = {
  monthlyLimitId: '01MT0000000000000000000001' as never,
  userId: 'user_honey' as never,
  expenseTypeId: '01EXP000000000000000000GYM' as never,
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

describe('defaultSeedLimitFor（規定経費種別の seed 上限。論点14 / OQ-19）', () => {
  it('AI 利用費はロール別（Honey=夫役 10,000円 / Darling=妻役 3,000円）', () => {
    expect(defaultSeedLimitFor('honey', 'ai_usage')).toEqual({ kind: 'capped', capAmount: 10000 })
    expect(defaultSeedLimitFor('darling', 'ai_usage')).toEqual({ kind: 'capped', capAmount: 3000 })
  })

  it('ジム・新聞図書費はロール共通 5,000円', () => {
    for (const role of ['honey', 'darling'] as const) {
      expect(defaultSeedLimitFor(role, 'gym')).toEqual({ kind: 'capped', capAmount: 5000 })
      expect(defaultSeedLimitFor(role, 'books_newspaper')).toEqual({
        kind: 'capped',
        capAmount: 5000,
      })
    }
  })

  it('交通費・その他経費は無制限（上限金額を持たない）', () => {
    for (const role of ['honey', 'darling'] as const) {
      expect(defaultSeedLimitFor(role, 'transportation')).toEqual({ kind: 'unlimited' })
      expect(defaultSeedLimitFor(role, 'other_expense')).toEqual({ kind: 'unlimited' })
    }
  })
})

describe('seedMonthlyLimit（08h: 月次上限をseed投入する）', () => {
  const seededAt = new Date('2026-07-25T00:00:00.000Z')
  const ids = {
    monthlyLimitId: testUlid('01MT', 9) as never,
    userId: 'user_honey' as never,
    expenseTypeId: testUlid('01EXP', 9) as never,
  }

  it('上限ありの seed 上限から capped な月次上限を作る（履歴は空・適用開始は投入日時）', () => {
    const limit = seedMonthlyLimit({
      ...ids,
      seedLimit: defaultSeedLimitFor('honey', 'ai_usage'),
      seededAt,
    })

    expect(limit).toEqual({
      kind: 'capped',
      ...ids,
      effectiveFrom: seededAt,
      capAmount: 10000,
      changeHistory: [],
    })
  })

  it('無制限の seed 上限から unlimited な月次上限を作る（上限金額を持たない）', () => {
    const limit = seedMonthlyLimit({
      ...ids,
      seedLimit: defaultSeedLimitFor('honey', 'transportation'),
      seededAt,
    })

    expect(limit).toEqual({ kind: 'unlimited', ...ids, effectiveFrom: seededAt })
    expect(limit).not.toHaveProperty('capAmount')
  })
})
