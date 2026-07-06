/**
 * 経費精算管理 Query I/F
 * @see docs/domain/08e-ul-経費精算.md §2
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.2
 *
 * プライバシー: 本人のみ可視（論点11）。viewerId は閲覧者かつ対象者であり、
 * adapter 実装は配偶者の経費精算管理ビューへのアクセスに PermissionDeniedError を
 * throw しなければならない（Phase 5 M-B）。
 */
import type { UserId } from '../../shared/ids'
import type { ExpenseSettlementManagementView } from './views/ExpenseSettlementManagementView'

export interface ExpenseSettlementManagementQuery {
  fetch(viewerId: UserId): Promise<ExpenseSettlementManagementView>
}
