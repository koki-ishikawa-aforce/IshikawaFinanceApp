import { describe, expect, it } from 'vitest'
import { formatMoney } from '../format'

describe('formatMoney', () => {
  it('円記号と3桁区切りで整形する', () => {
    expect(formatMoney(1234567)).toBe('¥1,234,567')
  })

  it('0 円を整形する', () => {
    expect(formatMoney(0)).toBe('¥0')
  })

  it('負の金額を整形する', () => {
    expect(formatMoney(-5000)).toBe('¥-5,000')
  })
})
