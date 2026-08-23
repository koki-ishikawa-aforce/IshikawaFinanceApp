/**
 * CategoryMasterRepository の PostgreSQL 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * 名前一意性（同一スコープ内）の最終保証は unique (name, owner_user_id)
 * NULLS NOT DISTINCT（§2.2 — find-before-save は事前チェックに格下げ）。
 */
import { asc, eq, isNull, or } from 'drizzle-orm'
import type { CategoryId, CategoryMaster, CategoryMasterRepository, UserId } from '@warimaru/domain'
import { CategoryMasterSchema, InvariantViolationError } from '@warimaru/domain'
import type { Db } from '../client'
import { categoryMasters } from '../schema'
import { parsePayload, serializeForPayload } from '../serialize'
import { isUniqueViolation } from '../pgErrors'

export class PostgresCategoryMasterRepository implements CategoryMasterRepository {
  constructor(private readonly db: Db) {}

  async findById(id: CategoryId): Promise<CategoryMaster | null> {
    const rows = await this.db
      .select({ payload: categoryMasters.payload })
      .from(categoryMasters)
      .where(eq(categoryMasters.categoryId, id))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(CategoryMasterSchema, row.payload)
  }

  async findAllVisibleToUser(userId: UserId): Promise<CategoryMaster[]> {
    // 世帯共有（owner NULL）+ 本人の個人別
    const rows = await this.db
      .select({ payload: categoryMasters.payload })
      .from(categoryMasters)
      .where(or(isNull(categoryMasters.ownerUserId), eq(categoryMasters.ownerUserId, userId)))
      .orderBy(asc(categoryMasters.categoryId))
    return rows.map(row => parsePayload(CategoryMasterSchema, row.payload))
  }

  async save(category: CategoryMaster): Promise<void> {
    const row = {
      categoryId: category.categoryId,
      kind: category.kind,
      name: category.name,
      ownerUserId: category.scope.kind === 'personal' ? category.scope.userId : null,
      payload: serializeForPayload(category),
    }
    const { categoryId: _pk, ...updateSet } = row
    try {
      await this.db
        .insert(categoryMasters)
        .values(row)
        .onConflictDoUpdate({
          target: categoryMasters.categoryId,
          set: { ...updateSet, updatedAt: new Date() },
        })
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new InvariantViolationError(
          `カテゴリ名は同一スコープ内で一意: ${category.name} は既に存在する`,
          e,
        )
      }
      throw e
    }
  }

  async deleteById(id: CategoryId): Promise<void> {
    await this.db.delete(categoryMasters).where(eq(categoryMasters.categoryId, id))
  }
}
