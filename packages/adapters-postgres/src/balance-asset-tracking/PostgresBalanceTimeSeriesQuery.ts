/**
 * BalanceTimeSeriesQuery の PostgreSQL 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §4.2
 *
 * 専用の残高履歴テーブルは設けない。月次レポート payload 内の
 * common.balanceTrend（4 軸時系列）を月範囲で読み出して合成する
 * （残高スナップショットの正は月次レポートに凍結済み）。
 * レポートが存在しない月は点を寄与しない（欠損月として自然に抜ける）。
 *
 * target_year_month はゼロ埋め 'YYYY-MM' のため辞書順比較が時系列順と一致する。
 */
import { and, asc, gte, lte } from 'drizzle-orm'
import type {
  BalancePoint,
  BalanceTimeSeriesQuery,
  BalanceTimeSeriesView,
  YearMonth,
} from '@warimaru/domain'
import { BalanceTimeSeriesViewSchema, MonthlyReportSchema } from '@warimaru/domain'
import type { Db } from '../client'
import { monthlyReports } from '../schema'
import { parsePayload } from '../serialize'

function sortByDate(points: BalancePoint[]): BalancePoint[] {
  return [...points].sort((a, b) => a.date.getTime() - b.date.getTime())
}

export class PostgresBalanceTimeSeriesQuery implements BalanceTimeSeriesQuery {
  constructor(private readonly db: Db) {}

  async fetch(from: YearMonth, to: YearMonth): Promise<BalanceTimeSeriesView> {
    const rows = await this.db
      .select({ payload: monthlyReports.payload })
      .from(monthlyReports)
      .where(
        and(gte(monthlyReports.targetYearMonth, from), lte(monthlyReports.targetYearMonth, to)),
      )
      .orderBy(asc(monthlyReports.targetYearMonth))

    const smbc: BalancePoint[] = []
    const otherSavings: BalancePoint[] = []
    const nisaContribution: BalancePoint[] = []
    const cardUnpaid: BalancePoint[] = []
    for (const row of rows) {
      const report = parsePayload(MonthlyReportSchema, row.payload)
      const trend = report.common.balanceTrend
      smbc.push(...trend.smbcBalanceTrend.map(p => ({ date: p.date, amount: p.balance })))
      otherSavings.push(
        ...trend.otherSavingsBalanceTrend.map(p => ({ date: p.date, amount: p.balance })),
      )
      nisaContribution.push(
        ...trend.nisaContributionTrend.map(p => ({ date: p.date, amount: p.accumulated })),
      )
      cardUnpaid.push(...trend.cardUnpaidTrend.map(p => ({ date: p.date, amount: p.unpaidTotal })))
    }

    return BalanceTimeSeriesViewSchema.parse({
      yearMonthRange: { from, to },
      smbc: sortByDate(smbc),
      otherSavings: sortByDate(otherSavings),
      nisaContribution: sortByDate(nisaContribution),
      cardUnpaid: sortByDate(cardUnpaid),
    })
  }
}
