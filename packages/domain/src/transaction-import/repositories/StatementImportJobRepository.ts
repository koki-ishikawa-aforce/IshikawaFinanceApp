/**
 * 明細取込ジョブ Repository I/F
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.3
 */
import type { ImportJobId, UserId } from '../../shared/ids'
import type { YearMonth } from '../../shared/value-objects/YearMonth'
import type { StatementImportJob } from '../aggregates/StatementImportJob'

export interface StatementImportJobRepository {
  findById(id: ImportJobId): Promise<StatementImportJob | null>
  findByUserAndMonth(uploaderUserId: UserId, targetMonth: YearMonth): Promise<StatementImportJob[]>
  save(job: StatementImportJob): Promise<void>
}
