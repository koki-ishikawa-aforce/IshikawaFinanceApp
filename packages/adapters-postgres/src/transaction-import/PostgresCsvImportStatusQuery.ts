/**
 * CsvImportStatusQuery の PostgreSQL 実装（通知配信のリマインダー停止判定が読む）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * 対象月に completed ジョブが複数あり得る（カード明細 + 銀行明細）ため、
 * completedAt が最新の 1 件で View を組む（リマインダー停止判定には
 * 「完了した事実と時刻」で十分 — 08a §2）。完了ジョブが無ければ null。
 */
import { and, eq } from 'drizzle-orm'
import type {
  CsvImportCompletionView,
  CsvImportStatusQuery,
  UserId,
  YearMonth,
} from '@warimaru/domain'
import { CsvImportCompletionViewSchema, StatementImportJobSchema } from '@warimaru/domain'
import type { Db } from '../client'
import { statementImportJobs } from '../schema'
import { parsePayload } from '../serialize'

export class PostgresCsvImportStatusQuery implements CsvImportStatusQuery {
  constructor(private readonly db: Db) {}

  async fetchCompletion(
    userId: UserId,
    targetMonth: YearMonth,
  ): Promise<CsvImportCompletionView | null> {
    const rows = await this.db
      .select({ payload: statementImportJobs.payload })
      .from(statementImportJobs)
      .where(
        and(
          eq(statementImportJobs.uploaderUserId, userId),
          eq(statementImportJobs.targetMonth, targetMonth),
          eq(statementImportJobs.kind, 'completed'),
        ),
      )
    const completed = rows
      .map(row => parsePayload(StatementImportJobSchema, row.payload))
      .flatMap(job => (job.kind === 'completed' ? [job] : []))
      .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime())
    const latest = completed[0]
    if (latest === undefined) return null
    return CsvImportCompletionViewSchema.parse({
      userId,
      targetMonth,
      importJobId: latest.common.importJobId,
      completedAt: latest.completedAt,
    })
  }
}
