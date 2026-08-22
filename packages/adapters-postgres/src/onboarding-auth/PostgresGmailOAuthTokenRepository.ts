/**
 * GmailOAuthTokenRepository の PostgreSQL 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * PK = userId（ユーザーごとに 1 件）。valid ⇔ revocation_detected の
 * 状態遷移は同一 PK の upsert で上書きする。
 */
import { eq } from 'drizzle-orm'
import type { GmailOAuthToken, GmailOAuthTokenRepository, UserId } from '@warimaru/domain'
import { GmailOAuthTokenSchema } from '@warimaru/domain'
import type { Db } from '../client'
import { gmailOauthTokens } from '../schema'
import { parsePayload, serializeForPayload } from '../serialize'

export class PostgresGmailOAuthTokenRepository implements GmailOAuthTokenRepository {
  constructor(private readonly db: Db) {}

  async findByUserId(userId: UserId): Promise<GmailOAuthToken | null> {
    const rows = await this.db
      .select({ payload: gmailOauthTokens.payload })
      .from(gmailOauthTokens)
      .where(eq(gmailOauthTokens.userId, userId))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(GmailOAuthTokenSchema, row.payload)
  }

  async save(token: GmailOAuthToken): Promise<void> {
    const row = {
      userId: token.userId,
      kind: token.kind,
      payload: serializeForPayload(token),
    }
    const { userId: _pk, ...updateSet } = row
    await this.db
      .insert(gmailOauthTokens)
      .values(row)
      .onConflictDoUpdate({
        target: gmailOauthTokens.userId,
        set: { ...updateSet, updatedAt: new Date() },
      })
  }
}
