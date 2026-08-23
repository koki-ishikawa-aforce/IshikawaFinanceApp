/**
 * DeliveryMessageRepository の PostgreSQL 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 */
import { eq } from 'drizzle-orm'
import type {
  DeliveryMessage,
  DeliveryMessageId,
  DeliveryMessageRepository,
} from '@warimaru/domain'
import { DeliveryMessageSchema } from '@warimaru/domain'
import type { Db } from '../client'
import { deliveryMessages } from '../schema'
import { parsePayload, serializeForPayload } from '../serialize'

export class PostgresDeliveryMessageRepository implements DeliveryMessageRepository {
  constructor(private readonly db: Db) {}

  async findById(id: DeliveryMessageId): Promise<DeliveryMessage | null> {
    const rows = await this.db
      .select({ payload: deliveryMessages.payload })
      .from(deliveryMessages)
      .where(eq(deliveryMessages.deliveryMessageId, id))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(DeliveryMessageSchema, row.payload)
  }

  async save(message: DeliveryMessage): Promise<void> {
    const row = {
      deliveryMessageId: message.common.deliveryMessageId,
      kind: message.kind,
      purpose: message.common.purpose,
      payload: serializeForPayload(message),
    }
    const { deliveryMessageId: _pk, ...updateSet } = row
    await this.db
      .insert(deliveryMessages)
      .values(row)
      .onConflictDoUpdate({
        target: deliveryMessages.deliveryMessageId,
        set: { ...updateSet, updatedAt: new Date() },
      })
  }
}
