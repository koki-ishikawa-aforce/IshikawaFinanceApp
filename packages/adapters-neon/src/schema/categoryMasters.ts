/**
 * category_masters テーブル（集約 #18 カテゴリマスタ）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * owner_user_id は scope の昇格: personal は userId、household_shared は NULL。
 * 名前一意性（同一スコープ内）は NULLS NOT DISTINCT の unique が最終保証
 * （world共有 = owner NULL 同士の重複も拒否する。素の UNIQUE では NULL 同士が
 *  重複可能になってしまうため）。
 */
import { pgTable, text, timestamp, jsonb, check, unique } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const categoryMasters = pgTable(
  'category_masters',
  {
    categoryId: text('category_id').primaryKey(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    ownerUserId: text('owner_user_id'),
    payload: jsonb('payload').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  t => [
    check('category_masters_kind_check', sql`${t.kind} IN ('default', 'custom')`),
    unique('category_masters_name_owner_unique').on(t.name, t.ownerUserId).nullsNotDistinct(),
  ],
)
