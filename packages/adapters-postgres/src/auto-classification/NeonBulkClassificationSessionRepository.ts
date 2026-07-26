/**
 * BulkClassificationSessionRepository の Neon 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * 進行中セッションの二重起動防止は partial unique (user_id) WHERE kind='in_progress'
 * が最終保証（§2.2）。同一 PK の upsert（in_progress → completed/aborted の遷移）は
 * この unique に触れない。
 */
import { and, eq } from 'drizzle-orm'
import type {
  BulkClassificationSession,
  BulkClassificationSessionId,
  BulkClassificationSessionRepository,
  UserId,
} from '@warimaru/domain'
import { BulkClassificationSessionSchema, InvariantViolationError } from '@warimaru/domain'
import type { Db } from '../client'
import { bulkClassificationSessions } from '../schema'
import { parsePayload, serializeForPayload } from '../serialize'
import { isUniqueViolation } from '../pgErrors'

export class NeonBulkClassificationSessionRepository implements BulkClassificationSessionRepository {
  constructor(private readonly db: Db) {}

  async findById(id: BulkClassificationSessionId): Promise<BulkClassificationSession | null> {
    const rows = await this.db
      .select({ payload: bulkClassificationSessions.payload })
      .from(bulkClassificationSessions)
      .where(eq(bulkClassificationSessions.bulkClassificationSessionId, id))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(BulkClassificationSessionSchema, row.payload)
  }

  async findInProgressByUser(userId: UserId): Promise<BulkClassificationSession | null> {
    // partial unique により 0..1 行
    const rows = await this.db
      .select({ payload: bulkClassificationSessions.payload })
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
    return parsePayload(BulkClassificationSessionSchema, row.payload)
  }

  async save(session: BulkClassificationSession): Promise<void> {
    const row = {
      bulkClassificationSessionId: session.common.bulkClassificationSessionId,
      userId: session.common.userId,
      kind: session.kind,
      payload: serializeForPayload(session),
    }
    const { bulkClassificationSessionId: _pk, ...updateSet } = row
    try {
      await this.db
        .insert(bulkClassificationSessions)
        .values(row)
        .onConflictDoUpdate({
          target: bulkClassificationSessions.bulkClassificationSessionId,
          set: { ...updateSet, updatedAt: new Date() },
        })
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
