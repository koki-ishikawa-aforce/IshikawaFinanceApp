/**
 * MonthlyReportQuery の Neon 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §4.2
 *
 * OQ-47: プライバシー3段階は Query/API 層で完全強制する。経費(会社)合計は本人のみ可視のため、
 * viewer の役割（honey / darling）を解決し、集約が保持する businessExpenseTotalHoney /
 * Darling から本人分だけを businessExpenseTotalSelf として射影する（配偶者分は返さない）。
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
import { MonthlyReportSchema, MonthlyReportViewSchema } from '@warimaru/domain'
import type { Db } from '../client'
import { monthlyReports } from '../schema'
import { parsePayload } from '../serialize'
import type { ResolveViewerRole } from '../queryDeps'

export interface NeonMonthlyReportQueryDeps {
  resolveViewerRole: ResolveViewerRole
}

function toView(report: MonthlyReport, viewerRole: UserRole): MonthlyReportView {
  const { businessExpenseTotalHoney, businessExpenseTotalDarling, ...restCommon } = report.common
  const businessExpenseTotalSelf =
    viewerRole === 'honey' ? businessExpenseTotalHoney : businessExpenseTotalDarling
  return MonthlyReportViewSchema.parse({
    status: report.kind,
    common: { ...restCommon, businessExpenseTotalSelf },
    csvConfirmedAt: report.csvConfirmedAt,
    finalizedAt: report.kind === 'finalized' ? report.finalizedAt : null,
    unapprovedTransfers: report.kind === 'finalized' ? report.unapprovedTransfers : null,
  })
}

export class NeonMonthlyReportQuery implements MonthlyReportQuery {
  constructor(
    private readonly db: Db,
    private readonly deps: NeonMonthlyReportQueryDeps,
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
