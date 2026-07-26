/**
 * merchant_learning_rules テーブル（集約 #4 加盟店学習ルール）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * PK = 複合自然キー (user_id, merchant_name)。専用 ID を持たない（ULID 発番なし）。
 * F-1: 全検索は user_id 起点（配偶者データ遮断は WHERE 句で構造化）。
 */
import { pgTable, text, timestamp, jsonb, check, primaryKey } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const merchantLearningRules = pgTable(
  'merchant_learning_rules',
  {
    userId: text('user_id').notNull(),
    merchantName: text('merchant_name').notNull(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  t => [
    primaryKey({ columns: [t.userId, t.merchantName] }),
    check('merchant_learning_rules_kind_check', sql`${t.kind} IN ('active', 'disabled')`),
  ],
)
