/**
 * YearMonth 値オブジェクト（"YYYY-MM" 形式）
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §4.2
 */
import { z } from 'zod'

export const YearMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM 形式である必要があります')
  .brand<'YearMonth'>()
export type YearMonth = z.infer<typeof YearMonthSchema>

export function yearMonth(year: number, month: number): YearMonth {
  const mm = String(month).padStart(2, '0')
  return YearMonthSchema.parse(`${year}-${mm}`)
}

export function previousMonth(ym: YearMonth, count = 1): YearMonth {
  const parts = ym.split('-').map(Number)
  const y = parts[0]
  const m = parts[1]
  if (y === undefined || m === undefined) {
    throw new Error(`Invalid YearMonth: ${ym}`)
  }
  let year = y
  let month = m
  for (let i = 0; i < count; i++) {
    if (month === 1) {
      year -= 1
      month = 12
    } else {
      month -= 1
    }
  }
  return yearMonth(year, month)
}
