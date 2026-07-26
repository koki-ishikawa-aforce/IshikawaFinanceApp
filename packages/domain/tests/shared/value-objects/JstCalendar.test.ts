import { describe, it, expect } from 'vitest'
import { jstCalendarParts, jstYearMonthOf } from '../../../src/shared/value-objects/JstCalendar'

describe('jstCalendarParts', () => {
  it('UTC の 15:00 は JST では翌日の 0:00 として扱われる', () => {
    expect(jstCalendarParts(new Date('2026-07-04T15:00:00Z'))).toEqual({
      year: 2026,
      month: 7,
      day: 5,
    })
  })

  it('UTC 基準ではまだ前日でも JST の暦日で判定する', () => {
    expect(jstCalendarParts(new Date('2026-07-04T20:00:00Z')).day).toBe(5)
  })

  it('月跨ぎで月が繰り上がる（冪等性キーの一部になるため境界を固定する）', () => {
    expect(jstCalendarParts(new Date('2026-06-30T15:00:00Z'))).toEqual({
      year: 2026,
      month: 7,
      day: 1,
    })
  })

  it('年跨ぎで年が繰り上がる', () => {
    expect(jstCalendarParts(new Date('2026-12-31T15:00:00Z'))).toEqual({
      year: 2027,
      month: 1,
      day: 1,
    })
  })
})

describe('jstYearMonthOf', () => {
  it('JST の年月を 2 桁ゼロ埋めで返す', () => {
    expect(jstYearMonthOf(new Date('2026-08-31T15:00:00Z'))).toBe('2026-09')
    expect(jstYearMonthOf(new Date('2026-12-31T15:00:00Z'))).toBe('2027-01')
  })
})
