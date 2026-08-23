import type { UserId } from '../../shared/ids'
import type { YearMonth } from '../../shared/value-objects/YearMonth'
import type { BalanceTimeSeriesView } from './views/BalanceTimeSeriesView'

export interface BalanceTimeSeriesQuery {
  /**
   * Phase 3.5 月次レポートの 4 軸時系列に対応。読み出し元は残高変動履歴（#398）。
   *
   * 残高は世帯フルオープン（夫婦のどちらが見ても同じ 4 本の線が返る）だが、規約どおり
   * 閲覧者を受け取る。フィルタしないことを「引数が無いから」で暗黙にせず、
   * 閲覧者を受けたうえで絞らないと明示するため（プライバシー3段階ルール）。
   */
  fetch(viewerId: UserId, from: YearMonth, to: YearMonth): Promise<BalanceTimeSeriesView>
}
