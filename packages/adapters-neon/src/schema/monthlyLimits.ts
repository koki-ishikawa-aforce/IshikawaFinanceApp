/**
 * monthly_limits テーブル（集約 #20 月次上限）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * 論点15（マジックナンバー不使用）を DB でも構造表現:
 * 無制限は cap_amount を持たない（NULL）ことを CHECK で強制する。
 */
import { pgTable, text, integer, timestamp, jsonb, check, unique } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const monthlyLimits = pgTable(
  'monthly_limits',
  {
    monthlyLimitId: text('monthly_limit_id').primaryKey(),
    userId: text('user_id').notNull(),
    expenseTypeId: text('expense_type_id').notNull(),
    kind: text('kind').notNull(),
    capAmount: integer('cap_amount'),
    payload: jsonb('payload').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  t => [
    check('monthly_limits_kind_check', sql`${t.kind} IN ('capped', 'unlimited')`),
    check(
      'monthly_limits_unlimited_cap_check',
      sql`(${t.kind} = 'unlimited') = (${t.capAmount} IS NULL)`,
    ),
    unique('monthly_limits_user_expense_type_unique').on(t.userId, t.expenseTypeId),
  ],
)
