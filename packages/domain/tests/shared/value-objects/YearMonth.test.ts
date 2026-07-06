import { describe, it, expect } from 'vitest'
import {
  YearMonthSchema,
  yearMonth,
  previousMonth,
} from '../../../src/shared/value-objects/YearMonth'

describe('YearMonth', () => {
  it('YYYY-MM 形式を受け入れる', () => {
    expect(() => YearMonthSchema.parse('2026-05')).not.toThrow()
    expect(() => YearMonthSchema.parse('2026-12')).not.toThrow()
    expect(() => YearMonthSchema.parse('2026-01')).not.toThrow()
  })

  it('不正フォーマットを拒否する', () => {
    expect(() => YearMonthSchema.parse('2026-5')).toThrow()
    expect(() => YearMonthSchema.parse('2026-13')).toThrow()
    expect(() => YearMonthSchema.parse('2026-00')).toThrow()
    expect(() => YearMonthSchema.parse('26-05')).toThrow()
    expect(() => YearMonthSchema.parse('2026/05')).toThrow()
  })

  it('yearMonth(2026, 5) は "2026-05" を返す', () => {
    expect(yearMonth(2026, 5)).toBe('2026-05')
  })

  it('yearMonth(2026, 12) は "2026-12" を返す', () => {
    expect(yearMonth(2026, 12)).toBe('2026-12')
  })

  it('previousMonth は前月を返す', () => {
    expect(previousMonth(yearMonth(2026, 5))).toBe('2026-04')
  })

  it('previousMonth は 1 月から前年 12 月に繰り下がる', () => {
    expect(previousMonth(yearMonth(2026, 1))).toBe('2025-12')
  })

  it('previousMonth(_, 5) は 5 ヶ月前を返す', () => {
    expect(previousMonth(yearMonth(2026, 5), 5)).toBe('2025-12')
  })

  it('previousMonth(_, 12) は前年同月を返す', () => {
    expect(previousMonth(yearMonth(2026, 5), 12)).toBe('2025-05')
  })
})
