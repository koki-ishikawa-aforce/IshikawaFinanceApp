import { describe, it, expect } from 'vitest'
import {
  jstCalendarParts,
  utcInstantOfJstDateTime,
  jstYearMonthOf,
  utcMidnightOfJstCalendarDate,
} from '../../../src/shared/value-objects/JstCalendar'

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

describe('utcMidnightOfJstCalendarDate', () => {
  it('暦日を UTC 深夜 0 時で表す（読み戻すと同じ JST 暦日になる）', () => {
    const date = utcMidnightOfJstCalendarDate(2026, 7, 13)
    expect(date).toEqual(new Date('2026-07-13T00:00:00Z'))
    expect(jstCalendarParts(date as Date)).toEqual({ year: 2026, month: 7, day: 13 })
  })

  it('実在しない日付は繰り上げず null を返す（取込元の外部入力を黙って別の日にしない）', () => {
    expect(utcMidnightOfJstCalendarDate(2026, 2, 30)).toBeNull()
    expect(utcMidnightOfJstCalendarDate(2026, 13, 1)).toBeNull()
    expect(utcMidnightOfJstCalendarDate(2026, 7, 0)).toBeNull()
    // うるう年でない年の 2/29
    expect(utcMidnightOfJstCalendarDate(2027, 2, 29)).toBeNull()
  })

  it('うるう年の 2 月 29 日は受理する', () => {
    expect(utcMidnightOfJstCalendarDate(2028, 2, 29)).toEqual(new Date('2028-02-29T00:00:00Z'))
  })
})

describe('utcInstantOfJstDateTime', () => {
  it('JST の日時をその瞬間の Date にする', () => {
    expect(utcInstantOfJstDateTime(2026, 7, 15, 14, 37)).toEqual(new Date('2026-07-15T05:37:00Z'))
  })

  it('JST 深夜帯は UTC では前日になる（暦日は JST で読み戻せる）', () => {
    const at = utcInstantOfJstDateTime(2026, 7, 15, 0, 5)
    expect(at).toEqual(new Date('2026-07-14T15:05:00Z'))
    expect(jstCalendarParts(at as Date)).toEqual({ year: 2026, month: 7, day: 15 })
  })

  it('その日の最後の時刻（23:59）は受理する', () => {
    expect(utcInstantOfJstDateTime(2026, 7, 15, 23, 59)).toEqual(new Date('2026-07-15T14:59:00Z'))
  })

  it('実在しない日時は null を返す（上限・下限・数値でない時刻）', () => {
    expect(utcInstantOfJstDateTime(2026, 2, 30, 10, 0)).toBeNull()
    expect(utcInstantOfJstDateTime(2026, 7, 15, 24, 0)).toBeNull()
    expect(utcInstantOfJstDateTime(2026, 7, 15, 10, 60)).toBeNull()
    // 下限を割った時刻を「前日の 23 時」として黙って受け入れない
    expect(utcInstantOfJstDateTime(2026, 7, 15, -1, 0)).toBeNull()
    expect(utcInstantOfJstDateTime(2026, 7, 15, 10, -5)).toBeNull()
    // 数値にならなかった時刻を Invalid Date として返さない
    expect(utcInstantOfJstDateTime(2026, 7, 15, Number.NaN, 0)).toBeNull()
    expect(utcInstantOfJstDateTime(2026, 7, 15, 10.5, 0)).toBeNull()
  })
})
