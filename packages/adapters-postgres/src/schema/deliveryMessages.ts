/**
 * delivery_messages テーブル（集約 #15 配信メッセージ）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 */
import { pgTable, text, timestamp, jsonb, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const deliveryMessages = pgTable(
  'delivery_messages',
  {
    deliveryMessageId: text('delivery_message_id').primaryKey(),
    kind: text('kind').notNull(),
    purpose: text('purpose').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  t => [
    check(
      'delivery_messages_kind_check',
      sql`${t.kind} IN ('reserved', 'sending', 'sent', 'failed', 'skipped')`,
    ),
    check(
      'delivery_messages_purpose_check',
      sql`${t.purpose} IN ('csv_import_reminder', 'monthly_report_household_summary', 'monthly_report_personal_summary', 'oauth_revocation_notice', 'test_message')`,
    ),
  ],
)
