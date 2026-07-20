/**
 * bulk_classification_sessions テーブル（集約 #6 一括分類セッション）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * 進行中セッションの二重起動防止は partial unique (user_id) WHERE kind = 'in_progress'
 * が最終保証（§2.2）。完了・中断行は複数残ってよい。
 */
import { pgTable, text, timestamp, jsonb, check, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const bulkClassificationSessions = pgTable(
  'bulk_classification_sessions',
  {
    bulkClassificationSessionId: text('bulk_classification_session_id').primaryKey(),
    userId: text('user_id').notNull(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  t => [
    check(
      'bulk_classification_sessions_kind_check',
      sql`${t.kind} IN ('in_progress', 'completed', 'aborted')`,
    ),
    uniqueIndex('idx_bulk_sessions_in_progress')
      .on(t.userId)
      .where(sql`${t.kind} = 'in_progress'`),
  ],
)
