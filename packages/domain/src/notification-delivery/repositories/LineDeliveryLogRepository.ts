/**
 * LINE配信ログ Repository I/F
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.6
 *
 * append-only: ログは監査記録であり更新は禁止（save は新規保存のみ、Phase 5 M-B）。
 * 同月レポート再送信の重複防止は save 前の findByIdempotencyKey で行う。
 */
import type { DeliveryLogId } from '../../shared/ids'
import type { LineDeliveryLog } from '../aggregates/LineDeliveryLog'

export interface LineDeliveryLogRepository {
  findById(id: DeliveryLogId): Promise<LineDeliveryLog | null>
  findByIdempotencyKey(idempotencyKey: string): Promise<LineDeliveryLog | null>
  save(log: LineDeliveryLog): Promise<void>
}
