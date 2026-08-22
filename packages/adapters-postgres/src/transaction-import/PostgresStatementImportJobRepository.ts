/**
 * StatementImportJobRepository の PostgreSQL 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 */
import { and, asc, eq } from 'drizzle-orm'
import type {
  ImportJobId,
  StatementImportJob,
  StatementImportJobRepository,
  UserId,
  YearMonth,
} from '@warimaru/domain'
import { StatementImportJobSchema } from '@warimaru/domain'
import type { Db } from '../client'
import { statementImportJobs } from '../schema'
import { parsePayload, serializeForPayload } from '../serialize'

export class PostgresStatementImportJobRepository implements StatementImportJobRepository {
  constructor(private readonly db: Db) {}

  async findById(id: ImportJobId): Promise<StatementImportJob | null> {
    const rows = await this.db
      .select({ payload: statementImportJobs.payload })
      .from(statementImportJobs)
      .where(eq(statementImportJobs.importJobId, id))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(StatementImportJobSchema, row.payload)
  }

  async findByUserAndMonth(
    uploaderUserId: UserId,
    targetMonth: YearMonth,
  ): Promise<StatementImportJob[]> {
    // 同月にカード明細 + 銀行明細の複数ジョブがあり得るため配列で返す
    const rows = await this.db
      .select({ payload: statementImportJobs.payload })
      .from(statementImportJobs)
      .where(
        and(
          eq(statementImportJobs.uploaderUserId, uploaderUserId),
          eq(statementImportJobs.targetMonth, targetMonth),
        ),
      )
      .orderBy(asc(statementImportJobs.importJobId))
    return rows.map(row => parsePayload(StatementImportJobSchema, row.payload))
  }

  async save(job: StatementImportJob): Promise<void> {
    const row = {
      importJobId: job.common.importJobId,
      uploaderUserId: job.common.uploaderUserId,
      targetMonth: job.common.targetMonth,
      kind: job.kind,
      payload: serializeForPayload(job),
    }
    const { importJobId: _pk, ...updateSet } = row
    await this.db
      .insert(statementImportJobs)
      .values(row)
      .onConflictDoUpdate({
        target: statementImportJobs.importJobId,
        set: { ...updateSet, updatedAt: new Date() },
      })
  }
}
