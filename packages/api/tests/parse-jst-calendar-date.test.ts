import { describe, it, expect } from 'vitest'
import { parseJstCalendarDate } from '../src/parse-jst-calendar-date.js'

describe('parseJstCalendarDate（取込経路共通の日付規約）', () => {
  it('YYYY/MM/DD と YYYY-MM-DD を UTC 深夜 0 時に変換する', () => {
    expect(parseJstCalendarDate('2026/07/05')?.toISOString()).toBe('2026-07-05T00:00:00.000Z')
    expect(parseJstCalendarDate('2026-07-05')?.toISOString()).toBe('2026-07-05T00:00:00.000Z')
  })

  it('前後の空白を許容する', () => {
    expect(parseJstCalendarDate('  2026/07/05  ')?.toISOString()).toBe('2026-07-05T00:00:00.000Z')
  })

  it('繰り上がり日付（2/30 等）は不正として null', () => {
    expect(parseJstCalendarDate('2026/02/30')).toBeNull()
  })

  it('形式不一致は null', () => {
    expect(parseJstCalendarDate('2026.07.05')).toBeNull()
    expect(parseJstCalendarDate('not-a-date')).toBeNull()
    expect(parseJstCalendarDate('')).toBeNull()
  })
})
