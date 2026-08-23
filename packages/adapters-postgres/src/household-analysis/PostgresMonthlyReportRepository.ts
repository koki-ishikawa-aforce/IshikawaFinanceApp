/**
 * MonthlyReportRepository の PostgreSQL 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §4.2
 */
import { eq } from 'drizzle-orm'
import type {
  MonthlyReport,
  MonthlyReportId,
  MonthlyReportRepository,
  YearMonth,
} from '@warimaru/domain'
import { InvariantViolationError, MonthlyReportSchema } from '@warimaru/domain'
import type { Db } from '../client'
import { monthlyReports } from '../schema'
import { parsePayload, serializeForPayload } from '../serialize'
import { isUniqueViolation } from '../pgErrors'

export class PostgresMonthlyReportRepository implements MonthlyReportRepository {
  constructor(private readonly db: Db) {}

  async findById(id: MonthlyReportId): Promise<MonthlyReport | null> {
    const rows = await this.db
      .select({ payload: monthlyReports.payload })
      .from(monthlyReports)
      .where(eq(monthlyReports.monthlyReportId, id))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(MonthlyReportSchema, row.payload)
  }

  async findByMonth(month: YearMonth): Promise<MonthlyReport | null> {
    // target_year_month UNIQUE により 0..1 行
    const rows = await this.db
      .select({ payload: monthlyReports.payload })
      .from(monthlyReports)
      .where(eq(monthlyReports.targetYearMonth, month))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(MonthlyReportSchema, row.payload)
  }

  async save(report: MonthlyReport): Promise<void> {
    const row = {
      monthlyReportId: report.common.monthlyReportId,
      targetYearMonth: report.common.targetYearMonth,
      kind: report.kind,
      payload: serializeForPayload(report),
    }
    const { monthlyReportId: _pk, ...updateSet } = row
    try {
      await this.db
        .insert(monthlyReports)
        .values(row)
        .onConflictDoUpdate({
          target: monthlyReports.monthlyReportId,
          set: { ...updateSet, updatedAt: new Date() },
        })
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new InvariantViolationError(
          `月次レポートは 1 月 1 件（世帯）: ${report.common.targetYearMonth} は既に存在する`,
          e,
        )
      }
      throw e
    }
  }
}
