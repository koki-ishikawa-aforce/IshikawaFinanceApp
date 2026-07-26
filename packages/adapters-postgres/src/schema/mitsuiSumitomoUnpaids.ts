/**
 * mitsui_sumitomo_unpaids テーブル（集約 #10 三井住友カード未払金）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §4.4
 *
 * entries（UnpaidEntry 配列）は payload 内に保持。
 * 「Σ 計上中エントリ = 当月未払金合計」は読み出し時の
 * MitsuiSumitomoUnpaidSchema.parse の superRefine が毎回検査する。
 * FK は同一コンテキスト内（accounts）のみ許可（M-B spec §2.1）。
 */
import { pgTable, text, integer, timestamp, jsonb } from 'drizzle-orm/pg-core'
import { accounts } from './accounts'

export const mitsuiSumitomoUnpaids = pgTable('mitsui_sumitomo_unpaids', {
  unpaidAggregateId: text('unpaid_aggregate_id').primaryKey(),
  accountId: text('account_id')
    .notNull()
    .unique()
    .references(() => accounts.accountId),
  currentMonthUnpaidTotal: integer('current_month_unpaid_total').notNull(),
  payload: jsonb('payload').$type<unknown>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
})
