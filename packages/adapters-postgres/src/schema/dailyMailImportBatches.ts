/**
 * daily_mail_import_batches テーブル（集約 #2 日次メール取込バッチ）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * 二重起動防止の partial unique は「進行中」= kind IN ('started', 'importing') で張る。
 * 集約に 'in_progress' という kind は存在しない（spec §5 カタログの表記は
 * Step 7 で実 kind に訂正）。
 */
import { pgTable, text, timestamp, jsonb, check, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const dailyMailImportBatches = pgTable(
  'daily_mail_import_batches',
  {
    importBatchId: text('import_batch_id').primaryKey(),
    userId: text('user_id').notNull(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  t => [
    check(
      'daily_mail_import_batches_kind_check',
      sql`${t.kind} IN ('started', 'importing', 'completed', 'failed')`,
    ),
    uniqueIndex('idx_mail_batches_in_progress')
      .on(t.userId)
      .where(sql`${t.kind} IN ('started', 'importing')`),
    // 直近バッチの引き当て（手動実行のクールダウン判定 #489）。状態を問わず引くため
    // partial unique では効かない。降順の読み出しは後方スキャンで賄えるので、他の索引と
    // 同じく昇順で宣言する（DESC 宣言だと NULLS 順がクエリ側と食い違い索引順を使えない）
    index('idx_mail_batches_user_created_at').on(t.userId, t.createdAt, t.importBatchId),
  ],
)
