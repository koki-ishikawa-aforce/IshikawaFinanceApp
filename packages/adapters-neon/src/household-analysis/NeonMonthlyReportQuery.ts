/**
 * MonthlyReportQuery の Neon 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §4.2
 *
 * viewerId は I/F 契約として受け取るが、本実装では未使用（予約引数）:
 * MonthlyReportView の common は経費(会社)サマリ（businessExpenseTotalHoney /
 * Darling）を non-null で要求するため、adapter 層でのマスキングは構造的に
 * 不可能。「経費(会社)サマリは本人のみ表示」は viewer の役割を知る画面層の
 * 責務とする（Phase 3.5 spec §6.3 ⑦）。
 */
import { eq } from 'drizzle-orm'
import type {
  MonthlyReport,
  MonthlyReportId,
  MonthlyReportQuery,
  MonthlyReportView,
  UserId,
  YearMonth,
} from '@warimaru/domain'
import { MonthlyReportSchema, MonthlyReportViewSchema } from '@warimaru/domain'
import type { Db } from '../client'
import { monthlyReports } from '../schema'
import { parsePayload } from '../serialize'

function toView(report: MonthlyReport): MonthlyReportView {
  return MonthlyReportViewSchema.parse({
    status: report.kind,
    common: report.common,
    csvConfirmedAt: report.csvConfirmedAt,
    finalizedAt: report.kind === 'finalized' ? report.finalizedAt : null,
    unapprovedTransfers: report.kind === 'finalized' ? report.unapprovedTransfers : null,
  })
}

export class NeonMonthlyReportQuery implements MonthlyReportQuery {
  constructor(private readonly db: Db) {}

  async fetchByMonth(_viewerId: UserId, month: YearMonth): Promise<MonthlyReportView | null> {
    const rows = await this.db
      .select({ payload: monthlyReports.payload })
      .from(monthlyReports)
      .where(eq(monthlyReports.targetYearMonth, month))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return toView(parsePayload(MonthlyReportSchema, row.payload))
  }

  async fetchById(_viewerId: UserId, id: MonthlyReportId): Promise<MonthlyReportView | null> {
    const rows = await this.db
      .select({ payload: monthlyReports.payload })
      .from(monthlyReports)
      .where(eq(monthlyReports.monthlyReportId, id))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return toView(parsePayload(MonthlyReportSchema, row.payload))
  }
}
