/**
 * 月境界の規約: YearMonth による月絞り込みは JST の暦月を意味する
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §3
 *
 * timestamptz カラムを月でバケットする際は本関数で UTC の半開区間へ変換する。
 * 素の UTC 月範囲で絞ると JST の毎月 1 日 00:00–08:59 の取引が前月に混入するため禁止。
 */
import type { YearMonth } from '@warimaru/domain'

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

/** 例: '2026-07' → [2026-06-30T15:00:00Z, 2026-07-31T15:00:00Z) */
export function yearMonthToUtcRange(ym: YearMonth): { fromUtc: Date; toUtc: Date } {
  const [yStr, mStr] = ym.split('-')
  if (yStr === undefined || mStr === undefined) {
    throw new Error(`Invalid YearMonth: ${ym}`)
  }
  const y = Number(yStr)
  const m = Number(mStr)
  return {
    fromUtc: new Date(Date.UTC(y, m - 1, 1) - JST_OFFSET_MS),
    toUtc: new Date(Date.UTC(y, m, 1) - JST_OFFSET_MS),
  }
}
