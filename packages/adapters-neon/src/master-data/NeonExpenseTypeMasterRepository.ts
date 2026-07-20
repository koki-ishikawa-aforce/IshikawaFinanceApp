/**
 * ExpenseTypeMasterRepository の Neon 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * カテゴリマスタと同構造（NeonCategoryMasterRepository 参照）。
 */
import { asc, eq, isNull, or } from 'drizzle-orm'
import type {
  ExpenseTypeId,
  ExpenseTypeMaster,
  ExpenseTypeMasterRepository,
  UserId,
} from '@warimaru/domain'
import { ExpenseTypeMasterSchema, InvariantViolationError } from '@warimaru/domain'
import type { Db } from '../client'
import { expenseTypeMasters } from '../schema'
import { parsePayload, serializeForPayload } from '../serialize'
import { isUniqueViolation } from '../pgErrors'

export class NeonExpenseTypeMasterRepository implements ExpenseTypeMasterRepository {
  constructor(private readonly db: Db) {}

  async findById(id: ExpenseTypeId): Promise<ExpenseTypeMaster | null> {
    const rows = await this.db
      .select({ payload: expenseTypeMasters.payload })
      .from(expenseTypeMasters)
      .where(eq(expenseTypeMasters.expenseTypeId, id))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(ExpenseTypeMasterSchema, row.payload)
  }

  async findAllVisibleToUser(userId: UserId): Promise<ExpenseTypeMaster[]> {
    const rows = await this.db
      .select({ payload: expenseTypeMasters.payload })
      .from(expenseTypeMasters)
      .where(or(isNull(expenseTypeMasters.ownerUserId), eq(expenseTypeMasters.ownerUserId, userId)))
      .orderBy(asc(expenseTypeMasters.expenseTypeId))
    return rows.map(row => parsePayload(ExpenseTypeMasterSchema, row.payload))
  }

  async save(expenseType: ExpenseTypeMaster): Promise<void> {
    const row = {
      expenseTypeId: expenseType.expenseTypeId,
      kind: expenseType.kind,
      name: expenseType.name,
      ownerUserId: expenseType.scope.kind === 'personal' ? expenseType.scope.userId : null,
      payload: serializeForPayload(expenseType),
    }
    const { expenseTypeId: _pk, ...updateSet } = row
    try {
      await this.db
        .insert(expenseTypeMasters)
        .values(row)
        .onConflictDoUpdate({
          target: expenseTypeMasters.expenseTypeId,
          set: { ...updateSet, updatedAt: new Date() },
        })
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new InvariantViolationError(
          `経費種別名は同一スコープ内で一意: ${expenseType.name} は既に存在する`,
          e,
        )
      }
      throw e
    }
  }
}
