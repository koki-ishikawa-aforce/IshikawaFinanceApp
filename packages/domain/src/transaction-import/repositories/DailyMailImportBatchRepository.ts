/**
 * 日次メール取込バッチ Repository I/F
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.3
 *
 * 二重起動防止は findInProgressByUser で保証する（Phase 5 M-B）。
 */
import type { ImportBatchId, UserId } from '../../shared/ids'
import type { DailyMailImportBatch } from '../aggregates/DailyMailImportBatch'

export interface DailyMailImportBatchRepository {
  findById(id: ImportBatchId): Promise<DailyMailImportBatch | null>
  findInProgressByUser(userId: UserId): Promise<DailyMailImportBatch | null>
  /**
   * そのユーザーの直近のバッチ（状態を問わない。起動が最も新しいもの）。
   * 手動実行のクールダウン判定に使う（#489。`judgeManualMailImportCooldown`）。
   */
  findLatestByUser(userId: UserId): Promise<DailyMailImportBatch | null>
  save(batch: DailyMailImportBatch): Promise<void>
}
