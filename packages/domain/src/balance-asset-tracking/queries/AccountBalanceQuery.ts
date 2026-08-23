/**
 * 口座残高 Query I/F
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §6.4
 *
 * 残高一覧は本人のみ可視（P2-B5 / AT-404）。配偶者の口座は 1 件ずつ返さず、
 * 別銀行貯蓄 + NISA 積立累計の合計だけを返す（OQ-60 ①）。
 * 資産合計は世帯の合計と 4 つの内訳を出し続けるため閲覧者で絞らない（OQ-60 ②）。
 */
import type { UserId } from '../../shared/ids'
import type { AccountBalanceListView } from './views/AccountBalanceListView'
import type { AssetTotalView } from './views/AssetTotalView'

export interface AccountBalanceQuery {
  fetchBalanceList(viewerId: UserId): Promise<AccountBalanceListView>
  fetchAssetTotal(asOf: Date): Promise<AssetTotalView>
}
