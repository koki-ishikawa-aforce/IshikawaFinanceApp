/**
 * AppUserRepository の PostgreSQL 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * unique (role) が「Honey / Darling 各 1 名」を最終保証（§2.2）。
 */
import { eq } from 'drizzle-orm'
import type { AppUser, AppUserRepository, UserId, UserRole } from '@warimaru/domain'
import { AppUserSchema, InvariantViolationError } from '@warimaru/domain'
import type { Db } from '../client'
import { appUsers } from '../schema'
import { parsePayload, serializeForPayload } from '../serialize'
import { isUniqueViolation } from '../pgErrors'

export class PostgresAppUserRepository implements AppUserRepository {
  constructor(private readonly db: Db) {}

  async findById(id: UserId): Promise<AppUser | null> {
    const rows = await this.db
      .select({ payload: appUsers.payload })
      .from(appUsers)
      .where(eq(appUsers.userId, id))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(AppUserSchema, row.payload)
  }

  async findByRole(role: UserRole): Promise<AppUser | null> {
    // unique (role) により 0..1 行
    const rows = await this.db
      .select({ payload: appUsers.payload })
      .from(appUsers)
      .where(eq(appUsers.role, role))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(AppUserSchema, row.payload)
  }

  async save(user: AppUser): Promise<void> {
    const row = {
      userId: user.common.userId,
      role: user.common.role,
      kind: user.kind,
      payload: serializeForPayload(user),
    }
    const { userId: _pk, ...updateSet } = row
    try {
      await this.db
        .insert(appUsers)
        .values(row)
        .onConflictDoUpdate({
          target: appUsers.userId,
          set: { ...updateSet, updatedAt: new Date() },
        })
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new InvariantViolationError(
          `役割 ${user.common.role} のユーザーは既に存在する（Honey / Darling 各 1 名）`,
          e,
        )
      }
      throw e
    }
  }
}
