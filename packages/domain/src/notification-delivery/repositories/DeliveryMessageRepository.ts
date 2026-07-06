/**
 * 配信メッセージ Repository I/F
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.6
 */
import type { DeliveryMessageId } from '../../shared/ids'
import type { DeliveryMessage } from '../aggregates/DeliveryMessage'

export interface DeliveryMessageRepository {
  findById(id: DeliveryMessageId): Promise<DeliveryMessage | null>
  save(message: DeliveryMessage): Promise<void>
}
