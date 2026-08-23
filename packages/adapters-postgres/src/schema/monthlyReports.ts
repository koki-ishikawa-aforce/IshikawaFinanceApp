/**
 * monthly_reports テーブル（集約 #8 月次レポート）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §4.2
 *
 * 世帯で月 1 レポートの前提を target_year_month UNIQUE で保証。
 * payload 内 common.balanceTrend は LINE 配信時点の残高の凍結値（#398）。
 * グラフが読む正は balance_history_entries に移り、BalanceTimeSeriesQuery は
 * そちらを読む（旧: 本テーブルの balanceTrend を月範囲で読む）。
 */
import { pgTable, text, timestamp, jsonb, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const monthlyReports = pgTable(
  'monthly_reports',
  {
    monthlyReportId: text('monthly_report_id').primaryKey(),
    targetYearMonth: text('target_year_month').notNull().unique(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  t => [
    // \d は tagged template のエスケープ事故を避けるため [0-9] 表記（意味は spec §4.2 と同一）
    check(
      'monthly_reports_target_year_month_check',
      sql`${t.targetYearMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`,
    ),
    check('monthly_reports_kind_check', sql`${t.kind} IN ('csv_confirmed', 'finalized')`),
  ],
)
