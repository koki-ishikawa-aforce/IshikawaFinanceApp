/**
 * app_users テーブル（集約 #14 アプリユーザー）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * PK = user_id（LINE userID、外部由来のため ULID 形式ではない）。
 * unique (role) が Honey / Darling 各 1 名（findByRole が単一を返す前提）を最終保証。
 */
import { pgTable, text, timestamp, jsonb, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const appUsers = pgTable(
  'app_users',
  {
    userId: text('user_id').primaryKey(),
    role: text('role').notNull().unique(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  t => [
    check('app_users_role_check', sql`${t.role} IN ('honey', 'darling')`),
    check(
      'app_users_kind_check',
      sql`${t.kind} IN ('phase1_completed', 'phase2_in_progress', 'phase2_completed', 'operation_started')`,
    ),
  ],
)
