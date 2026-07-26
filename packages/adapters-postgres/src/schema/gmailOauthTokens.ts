/**
 * gmail_oauth_tokens テーブル（#14 から M-A で集約分離した Gmail OAuth トークン）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * PK = user_id（ユーザーごとに 1 件、専用 ID なし）。実トークンは Parameter Store に
 * あり payload はパスのみ保持（OQ-27）。app_users への FK は張らない
 * （M-A で意図的に集約分離しており、保存順序を DB で結合しない）。
 */
import { pgTable, text, timestamp, jsonb, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const gmailOauthTokens = pgTable(
  'gmail_oauth_tokens',
  {
    userId: text('user_id').primaryKey(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  t => [check('gmail_oauth_tokens_kind_check', sql`${t.kind} IN ('valid', 'revocation_detected')`)],
)
