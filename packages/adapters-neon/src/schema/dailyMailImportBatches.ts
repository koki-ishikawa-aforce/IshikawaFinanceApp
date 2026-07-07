/**
 * daily_mail_import_batches テーブル（集約 #2 日次メール取込バッチ）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * 二重起動防止の partial unique は「進行中」= kind IN ('started', 'importing') で張る。
 * 集約に 'in_progress' という kind は存在しない（spec §5 カタログの表記は
 * Step 7 で実 kind に訂正）。
 */
import { pgTable, text, timestamp, jsonb, check, uniqueIndex } from 'drizzle-orm/pg-core'
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
  ],
)
