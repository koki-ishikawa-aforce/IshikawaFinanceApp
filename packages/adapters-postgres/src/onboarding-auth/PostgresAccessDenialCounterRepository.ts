/**
 * AccessDenialCounterRepository の PostgreSQL 実装（LINE_userID ごとに 1 行、Issue #651）
 * @see docs/domain/08f-ul-オンボーディング認証.md §1 §2
 *
 * カウンタは可変（拒否のたびに増加）のため通常の upsert。
 */
import { eq } from 'drizzle-orm'
import type { AccessDenialCounter, AccessDenialCounterRepository } from '@warimaru/domain'
import { AccessDenialCounterSchema, type UserId } from '@warimaru/domain'
import type { Db } from '../client'
import { accessDenialCounters } from '../schema'

export class PostgresAccessDenialCounterRepository implements AccessDenialCounterRepository {
  constructor(private readonly db: Db) {}

  async findByLineUserId(lineUserId: UserId): Promise<AccessDenialCounter | null> {
    const rows = await this.db
      .select({
        deniedCount: accessDenialCounters.deniedCount,
        lastDeniedAt: accessDenialCounters.lastDeniedAt,
      })
      .from(accessDenialCounters)
      .where(eq(accessDenialCounters.lineUserId, lineUserId))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return AccessDenialCounterSchema.parse({
      lineUserId,
      deniedCount: row.deniedCount,
      lastDeniedAt: row.lastDeniedAt,
    })
  }

  async save(counter: AccessDenialCounter): Promise<void> {
    await this.db
      .insert(accessDenialCounters)
      .values({
        lineUserId: counter.lineUserId,
        deniedCount: counter.deniedCount,
        lastDeniedAt: counter.lastDeniedAt,
      })
      .onConflictDoUpdate({
        target: accessDenialCounters.lineUserId,
        set: {
          deniedCount: counter.deniedCount,
          lastDeniedAt: counter.lastDeniedAt,
          updatedAt: new Date(),
        },
      })
  }
}
