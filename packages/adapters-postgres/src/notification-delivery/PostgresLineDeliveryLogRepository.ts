/**
 * LineDeliveryLogRepository の PostgreSQL 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §2.5, §5
 *
 * append-only: save は素の INSERT のみで onConflictDoUpdate を書かない
 * （UPDATE 経路が存在しないことの構造表現 — ログは不変監査レコード）。
 * PK 衝突・確定済み配信の idempotency_key 衝突はどちらも InvariantViolationError へ翻訳する。
 */
import { asc, eq } from 'drizzle-orm'
import type { DeliveryLogId, LineDeliveryLog, LineDeliveryLogRepository } from '@warimaru/domain'
import {
  deliveryLogOccurredAt,
  InvariantViolationError,
  LineDeliveryLogSchema,
} from '@warimaru/domain'
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

  async findAllByIdempotencyKey(idempotencyKey: string): Promise<LineDeliveryLog[]> {
    // 失敗ログは配信を確定させないため 0..N 行。確定判定は呼出し側の
    // concludedDeliveryOf が行うので、ここでは絞り込まず全件返す
    const rows = await this.db
      .select({ payload: lineDeliveryLogs.payload })
      .from(lineDeliveryLogs)
      .where(eq(lineDeliveryLogs.idempotencyKey, idempotencyKey))
      .orderBy(asc(lineDeliveryLogs.createdAt), asc(lineDeliveryLogs.deliveryLogId))
    // 並べ替えの正はドメインの発生日時。created_at 昇順で取ってから安定ソートするので、
    // 発生日時が同一のときは保存順（created_at）が保たれる
    return rows
      .map(row => parsePayload(LineDeliveryLogSchema, row.payload))
      .sort((a, b) => deliveryLogOccurredAt(a).getTime() - deliveryLogOccurredAt(b).getTime())
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
          `LINE配信ログは不変の監査レコード（append-only）: ${log.deliveryLogId} / 冪等性キー ${log.idempotencyKey} の配信は既に確定済み`,
          e,
        )
      }
      throw e
    }
  }
}
