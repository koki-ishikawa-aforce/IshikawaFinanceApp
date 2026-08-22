/**
 * ConsecutiveFailureCounterRepository の PostgreSQL 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * FailureCounterRef（user / talk_room）を複合 PK (ref_kind, ref_id) に展開する。
 * カウンタは可変（増加・リセット）のため通常の upsert。
 */
import { and, eq } from 'drizzle-orm'
import type {
  ConsecutiveFailureCounter,
  ConsecutiveFailureCounterRepository,
  FailureCounterRef,
} from '@warimaru/domain'
import { ConsecutiveFailureCounterSchema } from '@warimaru/domain'
import type { Db } from '../client'
import { consecutiveFailureCounters } from '../schema'
import { parsePayload, serializeForPayload } from '../serialize'

function refToColumns(ref: FailureCounterRef): { refKind: string; refId: string } {
  return ref.kind === 'user'
    ? { refKind: 'user', refId: ref.userId }
    : { refKind: 'talk_room', refId: ref.talkRoomId }
}

export class PostgresConsecutiveFailureCounterRepository implements ConsecutiveFailureCounterRepository {
  constructor(private readonly db: Db) {}

  async findByRef(ref: FailureCounterRef): Promise<ConsecutiveFailureCounter | null> {
    const { refKind, refId } = refToColumns(ref)
    const rows = await this.db
      .select({ payload: consecutiveFailureCounters.payload })
      .from(consecutiveFailureCounters)
      .where(
        and(
          eq(consecutiveFailureCounters.refKind, refKind),
          eq(consecutiveFailureCounters.refId, refId),
        ),
      )
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(ConsecutiveFailureCounterSchema, row.payload)
  }

  async save(counter: ConsecutiveFailureCounter): Promise<void> {
    const row = {
      ...refToColumns(counter.counterRef),
      payload: serializeForPayload(counter),
    }
    await this.db
      .insert(consecutiveFailureCounters)
      .values(row)
      .onConflictDoUpdate({
        target: [consecutiveFailureCounters.refKind, consecutiveFailureCounters.refId],
        set: { payload: row.payload, updatedAt: new Date() },
      })
  }
}
