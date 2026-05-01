/**
 * ダッシュボード Query I/F（Read 側、プライバシー適用済み）
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §5.4
 */
import type { UserId } from '../../shared/ids'
import type { YearMonth } from '../../shared/value-objects/YearMonth'
import type { DashboardKpisView } from './views/DashboardKpisView'
import type { CategoryBreakdownView } from './views/CategoryBreakdownView'

export type DashboardMode = 'household' | 'personal'

export interface DashboardQuery {
  fetchKpis(viewerId: UserId, month: YearMonth, mode: DashboardMode): Promise<DashboardKpisView>
  fetchCategoryBreakdown(
    viewerId: UserId,
    month: YearMonth,
    mode: DashboardMode,
  ): Promise<CategoryBreakdownView>
}
