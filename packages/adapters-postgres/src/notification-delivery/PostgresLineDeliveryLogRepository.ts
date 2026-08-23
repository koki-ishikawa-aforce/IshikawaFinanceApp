/**
 * LineDeliveryLogRepository の PostgreSQL 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §2.5, §5
 *
 * append-only: save は素の INSERT のみで onConflictDoUpdate を書かない
 * （UPDATE 経路が存在しないことの構造表現 — ログは不変監査レコード）。
 * PK 衝突・idempotency_key 衝突はどちらも InvariantViolationError へ翻訳する。
 */
import { eq } from 'drizzle-orm'
import type { DeliveryLogId, LineDeliveryLog, LineDeliveryLogRepository } from '@warimaru/domain'
import { InvariantViolationError, LineDeliveryLogSchema } from '@warimaru/domain'
import type { Db } from '../client'
import { lineDeliveryLogs } from '../schema'
import { parsePayload, serializeForPayload } from '../serialize'
import { isUniqueViolation } from '../pgErrors'

export class PostgresLineDeliveryLogRepository implements LineDeliveryLogRepository {
  constructor(private readonly db: Db) {}

  async findById(id: DeliveryLogId): Promise<LineDeliveryLog | null> {
    const rows = await this.db
      .select({ payload: lineDeliveryLogs.payload })
      .from(lineDeliveryLogs)
      .where(eq(lineDeliveryLogs.deliveryLogId, id))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(LineDeliveryLogSchema, row.payload)
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<LineDeliveryLog | null> {
    // unique (idempotency_key) により 0..1 行
    const rows = await this.db
      .select({ payload: lineDeliveryLogs.payload })
      .from(lineDeliveryLogs)
      .where(eq(lineDeliveryLogs.idempotencyKey, idempotencyKey))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(LineDeliveryLogSchema, row.payload)
  }

  async save(log: LineDeliveryLog): Promise<void> {
    try {
      await this.db.insert(lineDeliveryLogs).values({
        deliveryLogId: log.deliveryLogId,
        idempotencyKey: log.idempotencyKey,
        timingKind: log.timingKind,
        payload: serializeForPayload(log),
      })
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new InvariantViolationError(
          `LINE配信ログは不変の監査レコード（append-only）: ${log.deliveryLogId} / 冪等性キー ${log.idempotencyKey} は既に記録済み`,
          e,
        )
      }
      throw e
    }
  }
}
