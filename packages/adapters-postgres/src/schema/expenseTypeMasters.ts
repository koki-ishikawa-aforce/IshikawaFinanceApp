/**
 * expense_type_masters テーブル（集約 #19 経費種別マスタ）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * カテゴリマスタと同構造（categoryMasters.ts 参照）。
 */
import { pgTable, text, timestamp, jsonb, check, unique } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const expenseTypeMasters = pgTable(
  'expense_type_masters',
  {
    expenseTypeId: text('expense_type_id').primaryKey(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    ownerUserId: text('owner_user_id'),
    payload: jsonb('payload').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  t => [
    check('expense_type_masters_kind_check', sql`${t.kind} IN ('default', 'custom')`),
    unique('expense_type_masters_name_owner_unique').on(t.name, t.ownerUserId).nullsNotDistinct(),
  ],
)
