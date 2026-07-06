/**
 * 一括分類セッション Repository I/F
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.1
 *
 * 進行中セッションの二重起動防止は findInProgressByUser で保証する（Phase 5 M-B）。
 */
import type { BulkClassificationSessionId, UserId } from '../../shared/ids'
import type { BulkClassificationSession } from '../aggregates/BulkClassificationSession'

export interface BulkClassificationSessionRepository {
  findById(id: BulkClassificationSessionId): Promise<BulkClassificationSession | null>
  findInProgressByUser(userId: UserId): Promise<BulkClassificationSession | null>
  save(session: BulkClassificationSession): Promise<void>
}
