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
import { YearMonthSchema, jstCalendarParts } from '@warimaru/domain'

/**
 * 例: 2026-06-30T15:00:00Z（= JST 7/1 00:00）→ '2026-07-01'
 *
 * JST の暦日を読み取る計算そのものはドメイン（`jstCalendarParts`）に置いてある。ここは
 * 「date 型の列に入れる文字列表現」への整形だけを持つ（オフセットを層ごとに持つと、
 * 取込側が作る発生日時と検索側が導出する発生日の規約が割れる）。
 */
export function dateToJstCalendarDate(date: Date): string {
  const { year, month, day } = jstCalendarParts(date)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** 例: 2026-06-30T15:00:00Z（= JST 7/1 00:00）→ '2026-07' */
export function currentJstYearMonth(now: Date): YearMonth {
  return YearMonthSchema.parse(dateToJstCalendarDate(now).slice(0, 7))
}
