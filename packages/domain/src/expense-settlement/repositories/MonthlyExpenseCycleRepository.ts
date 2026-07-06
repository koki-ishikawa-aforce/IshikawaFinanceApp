/**
 * 月次経費サイクル Repository I/F
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.2
 *
 * 一意性（userId + targetYearMonth）は save 前の findByUserAndMonth で保証する（Phase 5 M-B）。
 */
import type { MonthlyExpenseCycleId, UserId } from '../../shared/ids'
import type { YearMonth } from '../../shared/value-objects/YearMonth'
import type { MonthlyExpenseCycle } from '../aggregates/MonthlyExpenseCycle'

export interface MonthlyExpenseCycleRepository {
  findById(id: MonthlyExpenseCycleId): Promise<MonthlyExpenseCycle | null>
  findByUserAndMonth(
    userId: UserId,
    targetYearMonth: YearMonth,
  ): Promise<MonthlyExpenseCycle | null>
  save(cycle: MonthlyExpenseCycle): Promise<void>
}
