import { describe, it, expect } from 'vitest'
import { dateToJstCalendarDate, currentJstYearMonth } from '../../src/jstCalendarDate'

describe('dateToJstCalendarDate（JST 暦日への変換、M-B spec §3）', () => {
  it('UTC 6/30 15:00（= JST 7/1 00:00）は 7/1 になる', () => {
    expect(dateToJstCalendarDate(new Date('2026-06-30T15:00:00.000Z'))).toBe('2026-07-01')
  })

  it('UTC 6/30 14:59（= JST 6/30 23:59）は 6/30 のまま', () => {
    expect(dateToJstCalendarDate(new Date('2026-06-30T14:59:59.999Z'))).toBe('2026-06-30')
  })

  it('UTC 12/31 15:00（= JST 1/1 00:00）は翌年 1/1 へ繰り上がる', () => {
    expect(dateToJstCalendarDate(new Date('2025-12-31T15:00:00.000Z'))).toBe('2026-01-01')
  })

  it('日中（UTC 7/7 03:00 = JST 7/7 12:00）は同日', () => {
    expect(dateToJstCalendarDate(new Date('2026-07-07T03:00:00.000Z'))).toBe('2026-07-07')
  })
})

describe('currentJstYearMonth（JST 暦月の導出）', () => {
  it('UTC 6/30 15:00（= JST 7/1 00:00）は 2026-07', () => {
    expect(currentJstYearMonth(new Date('2026-06-30T15:00:00.000Z'))).toBe('2026-07')
  })

  it('UTC 6/30 14:59（= JST 6/30 23:59）は 2026-06', () => {
    expect(currentJstYearMonth(new Date('2026-06-30T14:59:59.999Z'))).toBe('2026-06')
  })
})
