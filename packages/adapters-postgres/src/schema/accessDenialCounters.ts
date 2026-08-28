/**
 * access_denial_counters テーブル（アクセス拒否カウンタ、LINE_userID ごとに 1 行、Issue #651）
 * @see docs/domain/08f-ul-オンボーディング認証.md §1
 *
 * PK = line_user_id。同じ相手からの拒否は 1 行へ集約する（既存の連続失敗カウンタと同じ考え方。
 * 個々の発生時刻の履歴は残さない、決定 A-1）。
 */
import { pgTable, text, integer, timestamp } from 'drizzle-orm/pg-core'

export const accessDenialCounters = pgTable('access_denial_counters', {
  lineUserId: text('line_user_id').primaryKey(),
  deniedCount: integer('denied_count').notNull(),
  lastDeniedAt: timestamp('last_denied_at', { withTimezone: true, mode: 'date' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
})
