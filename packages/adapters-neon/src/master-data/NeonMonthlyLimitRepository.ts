/**
 * MonthlyLimitRepository の Neon 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * userId + expenseTypeId の一意性は unique index が最終保証（§2.2）。
 */
import { and, eq } from 'drizzle-orm'
import type {
  ExpenseTypeId,
  MonthlyLimit,
  MonthlyLimitId,
  MonthlyLimitRepository,
  UserId,
} from '@warimaru/domain'
import { InvariantViolationError, MonthlyLimitSchema } from '@warimaru/domain'
import type { Db } from '../client'
import { monthlyLimits } from '../schema'
import { parsePayload, serializeForPayload } from '../serialize'
import { isUniqueViolation } from '../pgErrors'

export class NeonMonthlyLimitRepository implements MonthlyLimitRepository {
  constructor(private readonly db: Db) {}

  async findById(id: MonthlyLimitId): Promise<MonthlyLimit | null> {
    const rows = await this.db
      .select({ payload: monthlyLimits.payload })
      .from(monthlyLimits)
      .where(eq(monthlyLimits.monthlyLimitId, id))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(MonthlyLimitSchema, row.payload)
  }

  async findByUserAndExpenseType(
    userId: UserId,
    expenseTypeId: ExpenseTypeId,
  ): Promise<MonthlyLimit | null> {
    // unique (user_id, expense_type_id) により 0..1 行
    const rows = await this.db
      .select({ payload: monthlyLimits.payload })
      .from(monthlyLimits)
      .where(and(eq(monthlyLimits.userId, userId), eq(monthlyLimits.expenseTypeId, expenseTypeId)))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(MonthlyLimitSchema, row.payload)
  }

  async save(limit: MonthlyLimit): Promise<void> {
    const row = {
      monthlyLimitId: limit.monthlyLimitId,
      userId: limit.userId,
      expenseTypeId: limit.expenseTypeId,
      kind: limit.kind,
      capAmount: limit.kind === 'capped' ? limit.capAmount : null,
      payload: serializeForPayload(limit),
    }
    const { monthlyLimitId: _pk, ...updateSet } = row
    try {
      await this.db
        .insert(monthlyLimits)
        .values(row)
        .onConflictDoUpdate({
          target: monthlyLimits.monthlyLimitId,
          set: { ...updateSet, updatedAt: new Date() },
        })
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new InvariantViolationError(
          `月次上限はユーザー + 経費種別で一意: (${limit.userId}, ${limit.expenseTypeId}) は既に存在する`,
          e,
        )
      }
      throw e
    }
  }
}
