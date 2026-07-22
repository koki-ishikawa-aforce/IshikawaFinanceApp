import { afterEach, describe, expect, it, vi } from 'vitest'
import { YearMonthSchema } from '@warimaru/domain'
import { formatDate, formatDateTime, formatMonthLabel, getCurrentMonth, shiftMonth } from '../month'

const ym = (value: string) => YearMonthSchema.parse(value)

describe('getCurrentMonth', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('現在日時を YYYY-MM 形式で返す', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-22T10:00:00'))
    expect(getCurrentMonth()).toBe('2026-07')
  })

  it('1桁の月をゼロ埋めする', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T00:00:00'))
    expect(getCurrentMonth()).toBe('2026-03')
  })
})

describe('shiftMonth', () => {
  it('月を進める', () => {
    expect(shiftMonth(ym('2026-07'), 1)).toBe('2026-08')
  })

  it('月を戻す', () => {
    expect(shiftMonth(ym('2026-07'), -1)).toBe('2026-06')
  })

  it('年をまたいで進める', () => {
    expect(shiftMonth(ym('2026-12'), 1)).toBe('2027-01')
  })

  it('年をまたいで戻す', () => {
    expect(shiftMonth(ym('2026-01'), -1)).toBe('2025-12')
  })

  it('12ヶ月を超える delta を処理する', () => {
    expect(shiftMonth(ym('2026-07'), 18)).toBe('2028-01')
    expect(shiftMonth(ym('2026-07'), -19)).toBe('2024-12')
  })
})

describe('formatMonthLabel', () => {
  it('YYYY年M月 形式で整形する(ゼロ埋めなし)', () => {
    expect(formatMonthLabel(ym('2026-07'))).toBe('2026年7月')
    expect(formatMonthLabel(ym('2026-12'))).toBe('2026年12月')
  })
})

describe('formatDate / formatDateTime', () => {
  it('M/D 形式で整形する', () => {
    expect(formatDate(new Date(2026, 6, 22))).toBe('7/22')
  })

  it('YYYY/M/D 形式で整形する', () => {
    expect(formatDateTime(new Date(2026, 6, 22))).toBe('2026/7/22')
  })
})
