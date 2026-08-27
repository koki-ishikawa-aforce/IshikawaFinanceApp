/**
 * bulk_classification_sessions テーブル（集約 #6 一括分類セッション）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * 進行中セッションの二重起動防止は partial unique (user_id) WHERE kind = 'in_progress'
 * が最終保証（§2.2）。完了・中断行は複数残ってよい。
 *
 * version: 楽観ロックのトークン（#609、口座 accounts.version #459 と同じ形）。
 * Repository.save は「読み出したときの版と一致する行だけを更新する」形で書き込み、
 * 更新できた行が無ければ ConcurrentUpdateError とみなす。既存行は NOT NULL DEFAULT 0 で埋める。
 */
import { pgTable, text, integer, timestamp, jsonb, check, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const bulkClassificationSessions = pgTable(
  'bulk_classification_sessions',
  {
    bulkClassificationSessionId: text('bulk_classification_session_id').primaryKey(),
    userId: text('user_id').notNull(),
    kind: text('kind').notNull(),
    version: integer('version').notNull().default(0),
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
