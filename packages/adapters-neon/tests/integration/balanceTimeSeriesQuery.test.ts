import { describe, it, expect } from 'vitest'
import { NeonBalanceTimeSeriesQuery } from '../../src/balance-asset-tracking/NeonBalanceTimeSeriesQuery'
import { NeonMonthlyReportRepository } from '../../src/household-analysis/NeonMonthlyReportRepository'
import { db } from './setup'
import { csvConfirmedReport, ym } from '../helpers/fixtures'

const repo = new NeonMonthlyReportRepository(db)
const query = new NeonBalanceTimeSeriesQuery(db)

describe('NeonBalanceTimeSeriesQuery', () => {
  it('月範囲の monthly_reports payload から 4 軸を date 昇順で合成する（欠損月は点なし）', async () => {
    // 2026-04, 2026-06 のみ存在（2026-05 は欠損月）
    await repo.save(csvConfirmedReport({ targetYearMonth: ym('2026-04') }))
    await repo.save(csvConfirmedReport({ targetYearMonth: ym('2026-06') }))
    // 範囲外
    await repo.save(csvConfirmedReport({ targetYearMonth: ym('2026-03') }))
    await repo.save(csvConfirmedReport({ targetYearMonth: ym('2026-07') }))

    const view = await query.fetch(ym('2026-04'), ym('2026-06'))
    expect(view.yearMonthRange).toEqual({ from: '2026-04', to: '2026-06' })
    // フィクスチャは各レポート 4 軸 × 1 点 → 2 レポート分で各軸 2 点
    expect(view.smbc).toHaveLength(2)
    expect(view.otherSavings).toHaveLength(2)
    expect(view.nisaContribution).toHaveLength(2)
    expect(view.cardUnpaid).toHaveLength(2)
    // date 昇順
    for (const axis of [view.smbc, view.otherSavings, view.nisaContribution, view.cardUnpaid]) {
      const times = axis.map(p => p.date.getTime())
      expect(times).toEqual([...times].sort((a, b) => a - b))
    }
    // BalanceTrend のフィールド名変換（balance / accumulated / unpaidTotal → amount）
    expect(view.smbc[0]).toMatchObject({ amount: 1500000 })
    expect(view.nisaContribution[0]).toMatchObject({ amount: 300000 })
    expect(view.cardUnpaid[0]).toMatchObject({ amount: 42000 })
  })

  it('レポートが 1 件もない範囲は空の 4 軸を返す', async () => {
    const view = await query.fetch(ym('2025-01'), ym('2025-03'))
    expect(view.smbc).toEqual([])
    expect(view.otherSavings).toEqual([])
    expect(view.nisaContribution).toEqual([])
    expect(view.cardUnpaid).toEqual([])
  })
})
