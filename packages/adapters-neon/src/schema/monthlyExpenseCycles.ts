/**
 * monthly_expense_cycles テーブル（集約 #11 月次経費サイクル）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * unique (user_id, target_year_month) が「ユーザー + 対象年月で一意」を最終保証。
 */
import { pgTable, text, timestamp, jsonb, check, unique } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const monthlyExpenseCycles = pgTable(
  'monthly_expense_cycles',
  {
    monthlyExpenseCycleId: text('monthly_expense_cycle_id').primaryKey(),
    userId: text('user_id').notNull(),
    targetYearMonth: text('target_year_month').notNull(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  t => [
    // \d は tagged template のエスケープ事故を避けるため [0-9] 表記（monthlyReports.ts と同じ）
    check(
      'monthly_expense_cycles_target_year_month_check',
      sql`${t.targetYearMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`,
    ),
    check(
      'monthly_expense_cycles_kind_check',
      sql`${t.kind} IN ('accumulating', 'csv_confirmed', 'finalized')`,
    ),
    unique('monthly_expense_cycles_user_month_unique').on(t.userId, t.targetYearMonth),
  ],
)
