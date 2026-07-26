/**
 * 暦日・暦月の規約: Date から導出する「日付」「当月」は JST の暦を意味する
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §3
 *
 * transaction_candidates.occurred_on（三項一致の発生日）や
 * ExpenseSettlementManagementQuery の「当月」判定は本モジュールで導出する。
 * UTC の暦をそのまま使うと JST 00:00–08:59 の出来事が前日/前月に化けるため禁止
 * （yearMonthToUtcRange の月境界規約と同根）。
 */
import type { YearMonth } from '@warimaru/domain'
import { YearMonthSchema } from '@warimaru/domain'

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

/** 例: 2026-06-30T15:00:00Z（= JST 7/1 00:00）→ '2026-07-01' */
export function dateToJstCalendarDate(date: Date): string {
  const jst = new Date(date.getTime() + JST_OFFSET_MS)
  const y = jst.getUTCFullYear()
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0')
  const d = String(jst.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 例: 2026-06-30T15:00:00Z（= JST 7/1 00:00）→ '2026-07' */
export function currentJstYearMonth(now: Date): YearMonth {
  return YearMonthSchema.parse(dateToJstCalendarDate(now).slice(0, 7))
}
