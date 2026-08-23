/**
 * AccountRepository の PostgreSQL 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §4.3
 *
 * 「同一ユーザー × 口座種別の一意性」（Phase 4 spec §6.3 で保留していた
 * 集約横断の不変条件）は UNIQUE (owner_user_id, kind) が最終保証し、
 * 違反は InvariantViolationError へ翻訳する。
 */
import { asc, eq } from 'drizzle-orm'
import type { Account, AccountId, AccountRepository, UserId } from '@warimaru/domain'
import { AccountSchema, InvariantViolationError } from '@warimaru/domain'
import type { Db } from '../client'
import { accounts } from '../schema'
import { parsePayload, serializeForPayload } from '../serialize'
import { isUniqueViolation } from '../pgErrors'

export class PostgresAccountRepository implements AccountRepository {
  constructor(private readonly db: Db) {}

  async findById(id: AccountId): Promise<Account | null> {
    const rows = await this.db
      .select({ payload: accounts.payload })
      .from(accounts)
      .where(eq(accounts.accountId, id))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(AccountSchema, row.payload)
  }

  async findByOwner(ownerId: UserId): Promise<Account[]> {
    const rows = await this.db
      .select({ payload: accounts.payload })
      .from(accounts)
      .where(eq(accounts.ownerUserId, ownerId))
      .orderBy(asc(accounts.kind))
    return rows.map(row => parsePayload(AccountSchema, row.payload))
  }

  async save(account: Account): Promise<void> {
    const row = {
      accountId: account.common.accountId,
      ownerUserId: account.common.ownerUserId,
      kind: account.kind,
      isActive: account.common.activeness.kind === 'active',
      payload: serializeForPayload(account),
    }
    const { accountId: _pk, ...updateSet } = row
    try {
      await this.db
        .insert(accounts)
        .values(row)
        .onConflictDoUpdate({
          target: accounts.accountId,
          set: { ...updateSet, updatedAt: new Date() },
        })
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new InvariantViolationError(
          `同一ユーザー × 口座種別は一意: (${account.common.ownerUserId}, ${account.kind}) は既に存在する`,
          e,
        )
      }
      throw e
    }
  }
}
