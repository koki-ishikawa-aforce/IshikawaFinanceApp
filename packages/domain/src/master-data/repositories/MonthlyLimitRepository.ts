/**
 * 月次上限 Repository I/F
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.5
 *
 * 一意性（userId + expenseTypeId）は save 前の findByUserAndExpenseType で保証する（Phase 5 M-B）。
 */
import type { MonthlyLimitId, UserId, ExpenseTypeId } from '../../shared/ids'
import type { MonthlyLimit } from '../aggregates/MonthlyLimit'

export interface MonthlyLimitRepository {
  findById(id: MonthlyLimitId): Promise<MonthlyLimit | null>
  findByUserAndExpenseType(
    userId: UserId,
    expenseTypeId: ExpenseTypeId,
  ): Promise<MonthlyLimit | null>
  save(limit: MonthlyLimit): Promise<void>
  /** 経費種別削除リマップ時の物理削除（全ユーザー分、削除可否は呼び出し側で検査する） */
  deleteByExpenseType(expenseTypeId: ExpenseTypeId): Promise<void>
}
