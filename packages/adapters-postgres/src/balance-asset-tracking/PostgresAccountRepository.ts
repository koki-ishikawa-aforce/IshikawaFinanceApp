/**
 * AccountRepository の PostgreSQL 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §4.3
 *
 * 「同一ユーザー × 口座種別の一意性」（Phase 4 spec §6.3 で保留していた
 * 集約横断の不変条件）は UNIQUE (owner_user_id, kind) が最終保証し、
 * 違反は InvariantViolationError へ翻訳する。
 *
 * 版数照合（楽観ロック、#459）: `version` 列を「読み出したときの版と一致する行だけを
 * 更新する」CAS で使う。更新できた行が無ければ、その間に別の更新が入ったとみなして
 * ConcurrentUpdateError を throw する。版は列を正とし、読み出し時に payload へ写す
 * （payload 側の version は保存の副産物で、読みでは使わない）。
 */
import { asc, eq } from 'drizzle-orm'
import type { Account, AccountId, AccountRepository, UserId } from '@warimaru/domain'
import { AccountSchema, ConcurrentUpdateError, InvariantViolationError } from '@warimaru/domain'
import type { Db } from '../client'
import { accounts } from '../schema'
import { parsePayload, serializeForPayload } from '../serialize'
import { isUniqueViolation } from '../pgErrors'

export class PostgresAccountRepository implements AccountRepository {
  constructor(private readonly db: Db) {}

  async findById(id: AccountId): Promise<Account | null> {
    const rows = await this.db
      .select({ payload: accounts.payload, version: accounts.version })
      .from(accounts)
      .where(eq(accounts.accountId, id))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return reviveWithVersion(row.payload, row.version)
  }

  async findByOwner(ownerId: UserId): Promise<Account[]> {
    const rows = await this.db
      .select({ payload: accounts.payload, version: accounts.version })
      .from(accounts)
      .where(eq(accounts.ownerUserId, ownerId))
      .orderBy(asc(accounts.kind))
    return rows.map(row => reviveWithVersion(row.payload, row.version))
  }

  async save(account: Account): Promise<void> {
    // 読み出したときの版。この版と保存先が一致するときだけ書き込む
    const expectedVersion = account.common.version
    const nextVersion = expectedVersion + 1
    const row = {
      accountId: account.common.accountId,
      ownerUserId: account.common.ownerUserId,
      kind: account.kind,
      isActive: account.common.activeness.kind === 'active',
      // 版数は version 列だけを正とし、payload には持たせない（読みは列で上書きするため、
      // payload.version を直接読む将来コードが古い値を掴む罠を作らない）。
      payload: serializeWithoutVersion(account),
    }
    try {
      // INSERT ... ON CONFLICT DO UPDATE ... WHERE version = expectedVersion。
      // 版が一致しなければ UPDATE は 0 行に落ち、RETURNING が空になる = 並行更新の検知。
      const written = await this.db
        .insert(accounts)
        // 新規口座（衝突しない）はそのまま読み出したときの版で入る。
        .values({ ...row, version: expectedVersion })
        // 既存口座は版が一致するときだけ 1 進めて更新する（一致しなければ 0 行）。
        .onConflictDoUpdate({
          target: accounts.accountId,
          set: { ...row, version: nextVersion, updatedAt: new Date() },
          setWhere: eq(accounts.version, expectedVersion),
        })
        .returning({ accountId: accounts.accountId })
      if (written.length === 0) {
        throw new ConcurrentUpdateError(
          `口座（${account.common.accountId}）は読み出し後に別の更新が入ったため保存できない（版数 ${expectedVersion} で照合）。もう一度お試しください。`,
        )
      }
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

/** payload を集約へ復元し、版数は列の値を正として上書きする */
function reviveWithVersion(payload: unknown, version: number): Account {
  const account = parsePayload(AccountSchema, payload)
  return withVersion(account, version)
}

/** 集約の版数だけを差し替える（型判別を崩さないよう common だけ更新する） */
function withVersion(account: Account, version: number): Account {
  return { ...account, common: { ...account.common, version } }
}

/**
 * 集約を payload へ変換する。版数は version 列で管理するため payload には残さない
 * （読み出しは列を正として上書きするので、payload に版数を残すと二重管理になる）。
 * この項目を持たない既存行と同じ形（version 無し）で書き、読み出し時は Zod の
 * `.default(0)` を通って列の値で上書きされる。
 */
function serializeWithoutVersion(account: Account): unknown {
  const payload = serializeForPayload(account)
  if (payload !== null && typeof payload === 'object' && 'common' in payload) {
    const common = (payload as { common: unknown }).common
    if (common !== null && typeof common === 'object') {
      delete (common as Record<string, unknown>).version
    }
  }
  return payload
}
