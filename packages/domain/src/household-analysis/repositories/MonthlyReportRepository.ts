/**
 * 月次レポート集約の永続化 I/F
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §5.3
 */
import type { MonthlyReportId } from '../../shared/ids'
import type { YearMonth } from '../../shared/value-objects/YearMonth'
import type { MonthlyReport } from '../aggregates/MonthlyReport'

export interface MonthlyReportRepository {
  findById(id: MonthlyReportId): Promise<MonthlyReport | null>
  findByMonth(month: YearMonth): Promise<MonthlyReport | null>
  save(report: MonthlyReport): Promise<void>
}
