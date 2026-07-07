/**
 * statement_import_jobs テーブル（集約 #3 明細取込ジョブ）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 */
import { pgTable, text, timestamp, jsonb, check, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const statementImportJobs = pgTable(
  'statement_import_jobs',
  {
    importJobId: text('import_job_id').primaryKey(),
    uploaderUserId: text('uploader_user_id').notNull(),
    targetMonth: text('target_month').notNull(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  t => [
    check(
      'statement_import_jobs_target_month_check',
      sql`${t.targetMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`,
    ),
    check(
      'statement_import_jobs_kind_check',
      sql`${t.kind} IN ('upload_accepted', 'pdf_converting', 'format_validating', 'importing', 'completed', 'failed')`,
    ),
    // findByUserAndMonth / CsvImportStatusQuery.fetchCompletion
    index('idx_statement_import_jobs_user_month').on(t.uploaderUserId, t.targetMonth),
  ],
)
