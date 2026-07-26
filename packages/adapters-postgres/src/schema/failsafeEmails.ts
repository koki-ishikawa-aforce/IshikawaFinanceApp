/**
 * failsafe_emails テーブル（集約 #17 フェイルセーフメール）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 */
import { pgTable, text, timestamp, jsonb, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const failsafeEmails = pgTable(
  'failsafe_emails',
  {
    failsafeEmailId: text('failsafe_email_id').primaryKey(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  t => [
    check(
      'failsafe_emails_kind_check',
      sql`${t.kind} IN ('reserved', 'sending', 'sent', 'failed')`,
    ),
  ],
)
