/**
 * 経費精算入金 Repository I/F
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.2
 */
import type { ExpenseReimbursementId, UserId } from '../../shared/ids'
import type { ExpenseReimbursementDeposit } from '../aggregates/ExpenseReimbursementDeposit'

export interface ExpenseReimbursementDepositRepository {
  findById(id: ExpenseReimbursementId): Promise<ExpenseReimbursementDeposit | null>
  findAwaitingByUser(userId: UserId): Promise<ExpenseReimbursementDeposit[]>
  save(deposit: ExpenseReimbursementDeposit): Promise<void>
}
