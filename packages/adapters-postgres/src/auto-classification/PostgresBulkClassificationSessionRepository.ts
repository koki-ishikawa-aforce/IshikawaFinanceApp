/**
 * BulkClassificationSessionRepository の PostgreSQL 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * 進行中セッションの二重起動防止は partial unique (user_id) WHERE kind='in_progress'
 * が最終保証（§2.2）。同一 PK の upsert（in_progress → completed/aborted の遷移）は
 * この unique に触れない。
 *
 * 版数照合（楽観ロック、#609）: `version` 列を「読み出したときの版と一致する行だけを
 * 更新する」CAS で使う。更新できた行が無ければ、その間に別の更新が入ったとみなして
 * ConcurrentUpdateError を throw する。版は列を正とし、読み出し時に payload へ写す
 * （payload 側の version は保存の副産物で、読みでは使わない）。口座 #459 と同じ形。
 */
import { and, eq } from 'drizzle-orm'
import type {
  BulkClassificationSession,
  BulkClassificationSessionId,
  BulkClassificationSessionRepository,
  UserId,
} from '@warimaru/domain'
import {
  BulkClassificationSessionSchema,
  ConcurrentUpdateError,
  InvariantViolationError,
} from '@warimaru/domain'
import type { Db } from '../client'
import { bulkClassificationSessions } from '../schema'
import { parsePayload, serializeForPayload } from '../serialize'
import { isUniqueViolation } from '../pgErrors'

export class PostgresBulkClassificationSessionRepository implements BulkClassificationSessionRepository {
  constructor(private readonly db: Db) {}

  async findById(id: BulkClassificationSessionId): Promise<BulkClassificationSession | null> {
    const rows = await this.db
      .select({
        payload: bulkClassificationSessions.payload,
        version: bulkClassificationSessions.version,
      })
      .from(bulkClassificationSessions)
      .where(eq(bulkClassificationSessions.bulkClassificationSessionId, id))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return reviveWithVersion(row.payload, row.version)
  }

  async findInProgressByUser(userId: UserId): Promise<BulkClassificationSession | null> {
    // partial unique により 0..1 行
    const rows = await this.db
      .select({
        payload: bulkClassificationSessions.payload,
        version: bulkClassificationSessions.version,
      })
      .from(bulkClassificationSessions)
      .where(
        and(
          eq(bulkClassificationSessions.userId, userId),
          eq(bulkClassificationSessions.kind, 'in_progress'),
        ),
      )
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return reviveWithVersion(row.payload, row.version)
  }

  async save(session: BulkClassificationSession): Promise<void> {
    // 読み出したときの版。この版と保存先が一致するときだけ書き込む
    const expectedVersion = session.common.version
    const nextVersion = expectedVersion + 1
    const row = {
      bulkClassificationSessionId: session.common.bulkClassificationSessionId,
      userId: session.common.userId,
      kind: session.kind,
      // 版数は version 列だけを正とし、payload には持たせない（読みは列で上書きするため、
      // payload.version を直接読む将来コードが古い値を掴む罠を作らない）。
      payload: serializeWithoutVersion(session),
    }
    const { bulkClassificationSessionId: _pk, ...updateSet } = row
    try {
      // INSERT ... ON CONFLICT DO UPDATE ... WHERE version = expectedVersion。
      // 版が一致しなければ UPDATE は 0 行に落ち、RETURNING が空になる = 並行更新の検知。
      const written = await this.db
        .insert(bulkClassificationSessions)
        // 新規セッション（衝突しない）はそのまま読み出したときの版で入る。
        .values({ ...row, version: expectedVersion })
        // 既存セッションは版が一致するときだけ 1 進めて更新する（一致しなければ 0 行）。
        .onConflictDoUpdate({
          target: bulkClassificationSessions.bulkClassificationSessionId,
          set: { ...updateSet, version: nextVersion, updatedAt: new Date() },
          setWhere: eq(bulkClassificationSessions.version, expectedVersion),
        })
        .returning({
          bulkClassificationSessionId: bulkClassificationSessions.bulkClassificationSessionId,
        })
      if (written.length === 0) {
        throw new ConcurrentUpdateError(
          `一括分類セッション（${session.common.bulkClassificationSessionId}）は読み出し後に別の更新が入ったため保存できない（版数 ${expectedVersion} で照合）。もう一度お試しください。`,
        )
      }
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new InvariantViolationError(
          `進行中の一括分類セッションは 1 ユーザー 1 件: ${session.common.userId} には既に進行中セッションがある`,
          e,
        )
      }
      throw e
    }
  }
}

/** payload を集約へ復元し、版数は列の値を正として上書きする */
function reviveWithVersion(payload: unknown, version: number): BulkClassificationSession {
  const session = parsePayload(BulkClassificationSessionSchema, payload)
  return withVersion(session, version)
}

/** 集約の版数だけを差し替える（型判別を崩さないよう common だけ更新する） */
function withVersion(
  session: BulkClassificationSession,
  version: number,
): BulkClassificationSession {
  return { ...session, common: { ...session.common, version } }
}

/**
 * 集約を payload へ変換する。版数は version 列で管理するため payload には残さない
 * （読み出しは列を正として上書きするので、payload に版数を残すと二重管理になる）。
 * この項目を持たない既存行と同じ形（version 無し）で書き、読み出し時は Zod の
 * `.default(0)` を通って列の値で上書きされる。
 */
function serializeWithoutVersion(session: BulkClassificationSession): unknown {
  const payload = serializeForPayload(session)
  if (payload !== null && typeof payload === 'object' && 'common' in payload) {
    const common = (payload as { common: unknown }).common
    if (common !== null && typeof common === 'object') {
      delete (common as Record<string, unknown>).version
    }
  }
  return payload
}
