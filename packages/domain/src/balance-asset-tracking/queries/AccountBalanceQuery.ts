/**
 * 口座残高 Query I/F
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §6.4
 *
 * 注: 残高・資産推移管理は世帯共有のため viewerId 引数を取らない。
 * プライバシー（取引明細）の概念は家計分析側にあり、本コンテキストには適用されない。
 */
import type { AccountBalanceListView } from './views/AccountBalanceListView'
import type { AssetTotalView } from './views/AssetTotalView'

export interface AccountBalanceQuery {
  fetchBalanceList(): Promise<AccountBalanceListView>
  fetchAssetTotal(asOf: Date): Promise<AssetTotalView>
}
