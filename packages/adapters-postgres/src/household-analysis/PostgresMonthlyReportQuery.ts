/**
 * MonthlyReportQuery の PostgreSQL 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §4.2
 *
 * プライバシー完全強制（#86 A② / #108）:
 * - 経費(会社)合計: 閲覧者本人分のみ `businessExpenseTotalSelf` として返す
 * - 不認定分振替: 閲覧者本人分のみ返す（経費由来データのため配偶者には非公開）
 * viewer の役割を解決して本人分を射影する。
 */
import { eq } from 'drizzle-orm'
import type {
  MonthlyReport,
  MonthlyReportId,
  MonthlyReportQuery,
  MonthlyReportView,
  UserId,
  UserRole,
  YearMonth,
} from '@warimaru/domain'
import {
  MonthlyReportSchema,
  MonthlyReportViewSchema,
  roleToPersonalExpenseClass,
  selfTotalsOf,
} from '@warimaru/domain'
import type { Db } from '../client'
import { monthlyReports } from '../schema'
import { parsePayload } from '../serialize'
import type { ResolveViewerRole } from '../queryDeps'

export interface PostgresMonthlyReportQueryDeps {
  resolveViewerRole: ResolveViewerRole
}

function toView(report: MonthlyReport, viewerRole: UserRole): MonthlyReportView {
  const {
    businessExpenseTotalHoney: _honey,
    businessExpenseTotalDarling: _darling,
    ...commonRest
  } = report.common
  // 本人分の抜き出しはドメインの selfTotalsOf に一本化する（LINE の個人サマリも同じ関数を通る）
  const { businessExpenseTotalSelf } = selfTotalsOf(report.common, viewerRole)
  return MonthlyReportViewSchema.parse({
    status: report.kind,
    common: { ...commonRest, businessExpenseTotalSelf },
    csvConfirmedAt: report.csvConfirmedAt,
    finalizedAt: report.kind === 'finalized' ? report.finalizedAt : null,
    unapprovedTransfers:
      report.kind === 'finalized'
        ? report.unapprovedTransfers.filter(
            t => t.transferTarget === roleToPersonalExpenseClass(viewerRole),
          )
        : null,
  })
}

export class PostgresMonthlyReportQuery implements MonthlyReportQuery {
  constructor(
    private readonly db: Db,
    private readonly deps: PostgresMonthlyReportQueryDeps,
  ) {}

  async fetchByMonth(viewerId: UserId, month: YearMonth): Promise<MonthlyReportView | null> {
    const rows = await this.db
      .select({ payload: monthlyReports.payload })
      .from(monthlyReports)
      .where(eq(monthlyReports.targetYearMonth, month))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    const role = await this.deps.resolveViewerRole(viewerId)
    return toView(parsePayload(MonthlyReportSchema, row.payload), role)
  }

  async fetchById(viewerId: UserId, id: MonthlyReportId): Promise<MonthlyReportView | null> {
    const rows = await this.db
      .select({ payload: monthlyReports.payload })
      .from(monthlyReports)
      .where(eq(monthlyReports.monthlyReportId, id))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    const role = await this.deps.resolveViewerRole(viewerId)
    return toView(parsePayload(MonthlyReportSchema, row.payload), role)
  }
}
