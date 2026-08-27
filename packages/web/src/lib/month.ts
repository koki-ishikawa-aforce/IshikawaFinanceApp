import { jstCalendarParts, jstYearMonthOf, type YearMonth } from '@warimaru/domain'
import { now } from './now'

export function getCurrentMonth(): YearMonth {
  return jstYearMonthOf(now())
}

export function shiftMonth(ym: YearMonth, delta: number): YearMonth {
  const [yStr, mStr] = ym.split('-')
  let y = Number(yStr)
  let m = Number(mStr) + delta
  while (m < 1) {
    y -= 1
    m += 12
  }
  while (m > 12) {
    y += 1
    m -= 12
  }
  return `${y}-${String(m).padStart(2, '0')}` as YearMonth
}

export function formatMonthLabel(ym: YearMonth | string): string {
  const [yStr, mStr] = ym.split('-')
  return `${yStr}年${Number(mStr)}月`
}

export function formatDate(date: Date): string {
  const { month, day } = jstCalendarParts(date)
  return `${month}/${day}`
}

/**
 * 年を含む日付（`2026/07/12`）。月ナビゲーションで年月が確定していない箇所
 * （複数の月をまたいで並ぶ遡及候補、最終更新日時などの記録）で使う（usability 5-4）。
 *
 * 月・日はゼロ埋めする。桁数が揃わないと縦に並んだ日付の位置がずれて読みにくい
 */
export function formatDateWithYear(date: Date): string {
  const { year, month, day } = jstCalendarParts(date)
  return `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`
}

/** `<input type="date">` 用(`YYYY-MM-DD`)。JST の暦日で決める(usability 5-4) */
export function toDateInputValue(date: Date): string {
  const { year, month, day } = jstCalendarParts(date)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
