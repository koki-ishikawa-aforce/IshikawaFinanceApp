import { describe, it, expect } from 'vitest'
import { YearMonthSchema } from '@warimaru/domain'
import { yearMonthToUtcRange } from '../../src/yearMonthToUtcRange'

describe('yearMonthToUtcRange（JST 暦月 → UTC 半開区間、M-B spec §3）', () => {
  it("'2026-07' → [2026-06-30T15:00:00Z, 2026-07-31T15:00:00Z)", () => {
    const { fromUtc, toUtc } = yearMonthToUtcRange(YearMonthSchema.parse('2026-07'))
    expect(fromUtc.toISOString()).toBe('2026-06-30T15:00:00.000Z')
    expect(toUtc.toISOString()).toBe('2026-07-31T15:00:00.000Z')
  })

  it('12 月は翌年 1 月へ正しく繰り上がる', () => {
    const { fromUtc, toUtc } = yearMonthToUtcRange(YearMonthSchema.parse('2026-12'))
    expect(fromUtc.toISOString()).toBe('2026-11-30T15:00:00.000Z')
    expect(toUtc.toISOString()).toBe('2026-12-31T15:00:00.000Z')
  })

  it('1 月は前年 12 月末からの区間になる', () => {
    const { fromUtc, toUtc } = yearMonthToUtcRange(YearMonthSchema.parse('2026-01'))
    expect(fromUtc.toISOString()).toBe('2025-12-31T15:00:00.000Z')
    expect(toUtc.toISOString()).toBe('2026-01-31T15:00:00.000Z')
  })

  it('JST 7/1 00:30（= UTC 6/30 15:30）は 7 月の区間に入る', () => {
    const { fromUtc, toUtc } = yearMonthToUtcRange(YearMonthSchema.parse('2026-07'))
    const jstJul1Early = new Date('2026-06-30T15:30:00.000Z')
    expect(jstJul1Early >= fromUtc && jstJul1Early < toUtc).toBe(true)
  })

  it('JST 8/1 00:00 ちょうど（= UTC 7/31 15:00）は 7 月の区間に入らない（半開区間）', () => {
    const { toUtc } = yearMonthToUtcRange(YearMonthSchema.parse('2026-07'))
    const jstAug1 = new Date('2026-07-31T15:00:00.000Z')
    expect(jstAug1 < toUtc).toBe(false)
  })
})
