/**
 * MonthlyExpenseCycleRepository の Neon 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * userId + targetYearMonth の一意性は unique index が最終保証（§2.2）。
 */
import { and, eq } from 'drizzle-orm'
import type {
  MonthlyExpenseCycle,
  MonthlyExpenseCycleId,
  MonthlyExpenseCycleRepository,
  UserId,
  YearMonth,
} from '@warimaru/domain'
import { InvariantViolationError, MonthlyExpenseCycleSchema } from '@warimaru/domain'
import type { Db } from '../client'
import { monthlyExpenseCycles } from '../schema'
import { parsePayload, serializeForPayload } from '../serialize'
import { isUniqueViolation } from '../pgErrors'

export class NeonMonthlyExpenseCycleRepository implements MonthlyExpenseCycleRepository {
  constructor(private readonly db: Db) {}

  async findById(id: MonthlyExpenseCycleId): Promise<MonthlyExpenseCycle | null> {
    const rows = await this.db
      .select({ payload: monthlyExpenseCycles.payload })
      .from(monthlyExpenseCycles)
      .where(eq(monthlyExpenseCycles.monthlyExpenseCycleId, id))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(MonthlyExpenseCycleSchema, row.payload)
  }

  async findByUserAndMonth(
    userId: UserId,
    targetYearMonth: YearMonth,
  ): Promise<MonthlyExpenseCycle | null> {
    // unique (user_id, target_year_month) により 0..1 行
    const rows = await this.db
      .select({ payload: monthlyExpenseCycles.payload })
      .from(monthlyExpenseCycles)
      .where(
        and(
          eq(monthlyExpenseCycles.userId, userId),
          eq(monthlyExpenseCycles.targetYearMonth, targetYearMonth),
        ),
      )
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(MonthlyExpenseCycleSchema, row.payload)
  }

  async save(cycle: MonthlyExpenseCycle): Promise<void> {
    const row = {
      monthlyExpenseCycleId: cycle.common.monthlyExpenseCycleId,
      userId: cycle.common.userId,
      targetYearMonth: cycle.common.targetYearMonth,
      kind: cycle.kind,
      payload: serializeForPayload(cycle),
    }
    const { monthlyExpenseCycleId: _pk, ...updateSet } = row
    try {
      await this.db
        .insert(monthlyExpenseCycles)
        .values(row)
        .onConflictDoUpdate({
          target: monthlyExpenseCycles.monthlyExpenseCycleId,
          set: { ...updateSet, updatedAt: new Date() },
        })
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new InvariantViolationError(
          `月次経費サイクルはユーザー + 対象年月で一意: (${cycle.common.userId}, ${cycle.common.targetYearMonth}) は既に存在する`,
          e,
        )
      }
      throw e
    }
  }
}
