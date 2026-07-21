/**
 * 経費精算管理 Query I/F
 * @see docs/domain/08e-ul-経費精算.md §2
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.2
 *
 * プライバシー: 本人のみ可視（論点11）。viewerId は閲覧者かつ対象者であり、
 * adapter 実装は `canViewExpenseSettlement` で判定し、配偶者の経費精算管理ビューへの
 * アクセスに PermissionDeniedError を throw しなければならない（Phase 5 M-B）。
 */
import type { UserId } from '../../shared/ids'
import type { YearMonth } from '../../shared/value-objects/YearMonth'
import type { ExpenseSettlementManagementView } from './views/ExpenseSettlementManagementView'

/**
 * 論点11（本人のみ可視）のドメイン側判定ポイント。
 * household-analysis の applyPrivacyFilter と同じ高度でプライバシー層を強制する。
 * adapter はビューを返す前に必ずこの判定を通すこと。
 */
export function canViewExpenseSettlement(
  view: ExpenseSettlementManagementView,
  viewerId: UserId,
): boolean {
  return view.userId === viewerId
}

export interface ExpenseSettlementManagementQuery {
  /**
   * @param targetMonth 対象月。省略時は当月（JST 暦月）。過去月を指定すると
   *   その月のサイクルの累計・按分子取引を返す（過去月の精算履歴閲覧用）。
   */
  fetch(viewerId: UserId, targetMonth?: YearMonth): Promise<ExpenseSettlementManagementView>
}
