/**
 * line_delivery_logs テーブル（集約 #16 LINE配信ログ）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * append-only の不変監査レコード（adapter は INSERT のみ実装、§2.5）。
 * 再送信の重複防止（OQ-34）の最終保証は partial unique index が担う。送信失敗のログは
 * 配信を確定させない（#441-A）ため、同一 idempotency_key に失敗行が複数並びうる。
 * 「確定した配信は 1 件」だけを DB 側の最後の砦として残す。
 * 保持期間ポリシーは OQ-34（実装フェーズ論点）。
 *
 * 判別子（成功 / 失敗 / スキップ）は他テーブルの kind 列と違い payload 内の
 * resultStatus.kind を式で参照する。列に materialize すると既存行への NOT NULL 追加が
 * 必要になり、本番の既存ログを止めずに移行できないため（-> / ->> は IMMUTABLE なので
 * 索引式に使える）。判定の正は domain の concludesDelivery。
 */
import { pgTable, text, timestamp, jsonb, check, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const lineDeliveryLogs = pgTable(
  'line_delivery_logs',
  {
    deliveryLogId: text('delivery_log_id').primaryKey(),
    idempotencyKey: text('idempotency_key').notNull(),
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
    // findAllByIdempotencyKey（#441-A の配信確定判定）。下の partial unique index は
    // 述語を含意しない検索には使えないため、全行を対象とする索引を別に張る
    index('idx_line_delivery_logs_idempotency_key').on(t.idempotencyKey, t.createdAt),
    // 確定した配信は冪等性キーごとに高々 1 件（判定の正は domain の concludesDelivery）。
    // 索引から外す = 何行でも積める のは「未達が確定していて再送信する失敗」だけで、
    // domain の CONCLUDES_BY_FAILURE_REASON が false を返す理由と一致させる。
    // 述語を IS NOT TRUE で包むのは、判別子や失敗理由が読めない行（NULL）を
    // 索引の対象から落とさないため（NOT だけだと述語が NULL になり、
    // その行だけ最後の砦が黙って外れる）
    uniqueIndex('idx_line_delivery_logs_concluded_idempotency_key')
      .on(t.idempotencyKey)
      .where(
        sql`(${t.payload}->'resultStatus'->>'kind' = 'failure' AND ${t.payload}->'resultStatus'->>'failureReason' = 'line_api_failure') IS NOT TRUE`,
      ),
  ],
)
