/**
 * line_delivery_logs テーブル（集約 #16 LINE配信ログ）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * append-only の不変監査レコード（adapter は INSERT のみ実装、§2.5）。
 * unique (idempotency_key) が再送信の重複防止（OQ-34）を最終保証。
 * 保持期間ポリシーは OQ-34（実装フェーズ論点）。
 */
import { pgTable, text, timestamp, jsonb, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const lineDeliveryLogs = pgTable(
  'line_delivery_logs',
  {
    deliveryLogId: text('delivery_log_id').primaryKey(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    timingKind: text('timing_kind').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  t => [
    check(
      'line_delivery_logs_timing_kind_check',
      sql`${t.timingKind} IN ('reminder', 'csv_confirmation', 'oauth_revocation_detected', 'test_send')`,
    ),
  ],
)
