/**
 * balance_history_entries テーブル（集約 #10c 残高変動履歴エントリ、#398）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §4.2b
 *
 * append-only。資産の推移グラフ（BalanceTimeSeriesQuery）が読む正で、
 * 月次レポートの balanceTrend は本テーブルから写し取った凍結値に変わった。
 *
 * UNIQUE (axis, source_event_id): 同じ変動が二度届いてもグラフに点が重ならないことの
 * 最終保証。イベント配信は at-least-once（#34）で、ハンドラー側のチェックだけでは
 * 並行実行を取りこぼす。
 *
 * balance は payload にも入るが列にも持つ。時系列の読み出しは範囲内の全行を舐めるため、
 * 1 行ずつ jsonb を parse せずに済ませる（他テーブルの集計列と同じ扱い）。
 * FK は同一コンテキスト内（accounts）のみ許可（M-B spec §2.1）。
 */
import { pgTable, text, integer, timestamp, jsonb, check, index, unique } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { accounts } from './accounts'

export const balanceHistoryEntries = pgTable(
  'balance_history_entries',
  {
    entryId: text('entry_id').primaryKey(),
    axis: text('axis').notNull(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.accountId),
    balance: integer('balance').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    sourceEventId: text('source_event_id').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  t => [
    check(
      'balance_history_entries_axis_check',
      sql`${t.axis} IN ('smbc_balance', 'other_savings_balance', 'nisa_contribution', 'card_unpaid')`,
    ),
    unique('balance_history_entries_axis_source_event_id_unique').on(t.axis, t.sourceEventId),
    // 軸ごとの期間読み出し（グラフの描画・月次レポートへの凍結）が唯一の検索パターン
    index('idx_balance_history_entries_axis_occurred_at').on(t.axis, t.occurredAt),
  ],
)
