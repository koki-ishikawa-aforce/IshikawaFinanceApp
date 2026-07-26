/**
 * FailsafeEmailRepository の Neon 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 */
import { eq } from 'drizzle-orm'
import type { FailsafeEmail, FailsafeEmailId, FailsafeEmailRepository } from '@warimaru/domain'
import { FailsafeEmailSchema } from '@warimaru/domain'
import type { Db } from '../client'
import { failsafeEmails } from '../schema'
import { parsePayload, serializeForPayload } from '../serialize'

export class NeonFailsafeEmailRepository implements FailsafeEmailRepository {
  constructor(private readonly db: Db) {}

  async findById(id: FailsafeEmailId): Promise<FailsafeEmail | null> {
    const rows = await this.db
      .select({ payload: failsafeEmails.payload })
      .from(failsafeEmails)
      .where(eq(failsafeEmails.failsafeEmailId, id))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(FailsafeEmailSchema, row.payload)
  }

  async save(email: FailsafeEmail): Promise<void> {
    const row = {
      failsafeEmailId: email.common.failsafeEmailId,
      kind: email.kind,
      payload: serializeForPayload(email),
    }
    const { failsafeEmailId: _pk, ...updateSet } = row
    await this.db
      .insert(failsafeEmails)
      .values(row)
      .onConflictDoUpdate({
        target: failsafeEmails.failsafeEmailId,
        set: { ...updateSet, updatedAt: new Date() },
      })
  }
}
