/**
 * ダッシュボード Query I/F（Read 側、プライバシー適用済み）
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §5.4
 */
import type { UserId } from '../../shared/ids'
import type { YearMonth } from '../../shared/value-objects/YearMonth'
import type { DashboardKpisView } from './views/DashboardKpisView'
import type { CategoryBreakdownView } from './views/CategoryBreakdownView'
import type { BalanceFreshnessListView } from './views/BalanceFreshnessListView'

export type DashboardMode = 'household' | 'personal'

export interface DashboardQuery {
  fetchKpis(viewerId: UserId, month: YearMonth, mode: DashboardMode): Promise<DashboardKpisView>
  fetchCategoryBreakdown(
    viewerId: UserId,
    month: YearMonth,
    mode: DashboardMode,
  ): Promise<CategoryBreakdownView>
  /**
   * 残高鮮度評価リスト（08c `data ダッシュボード集計` の一項目）。
   *
   * 残高は「本人のみ可視。別銀行貯蓄 + NISA は合計のみ配偶者可視」（P2-B5 /
   * `docs/acceptance/05-privacy.md` AT-404）のため、口座単位の鮮度は**本人所有の
   * 口座に限る**。配偶者の口座は件数も銀行名も返さない。
   * 現在日時は Query 実装が持つクロックから採る。
   */
  fetchBalanceFreshness(viewerId: UserId): Promise<BalanceFreshnessListView>
}
