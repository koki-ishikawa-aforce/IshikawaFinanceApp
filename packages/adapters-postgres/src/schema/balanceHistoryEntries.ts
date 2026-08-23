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
 * value（変動後の値）は payload にも入るが列にも持つ。手書きのデータ移行 DML から
 * 値を投入・確認しやすくするため（他テーブルの集計列と同じ扱い）。
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
    value: integer('value').notNull(),
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
    // 期間読み出し（BalanceTimeSeriesQuery.fetch / findByOccurredAtRange）。
    // 軸で絞らず発生日時だけで範囲を切るため、先頭列は occurred_at にする
    index('idx_balance_history_entries_occurred_at').on(t.occurredAt),
    // 期間の起点になる「(軸, 口座) ごとの直前値」（findLatestPerAccountBefore）の
    // DISTINCT ON 用。並び順（axis, account_id, occurred_at DESC）に合わせる
    index('idx_balance_history_entries_axis_account_occurred_at').on(
      t.axis,
      t.accountId,
      t.occurredAt,
    ),
  ],
)
