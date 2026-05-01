import type { YearMonth } from '../../shared/value-objects/YearMonth'
import type { BalanceTimeSeriesView } from './views/BalanceTimeSeriesView'

export interface BalanceTimeSeriesQuery {
  /** Phase 3.5 月次レポートの 4 軸時系列に対応 */
  fetch(from: YearMonth, to: YearMonth): Promise<BalanceTimeSeriesView>
}
