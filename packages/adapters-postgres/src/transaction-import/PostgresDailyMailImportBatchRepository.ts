/**
 * DailyMailImportBatchRepository の PostgreSQL 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * 「進行中」= kind IN ('started', 'importing')。二重起動防止は
 * partial unique (user_id) WHERE kind IN ('started', 'importing') が最終保証（§2.2）。
 */
import { and, desc, eq, inArray } from 'drizzle-orm'
import type {
  DailyMailImportBatch,
  DailyMailImportBatchRepository,
  ImportBatchId,
  UserId,
} from '@warimaru/domain'
import { DailyMailImportBatchSchema, InvariantViolationError } from '@warimaru/domain'
import type { Db } from '../client'
import { dailyMailImportBatches } from '../schema'
import { parsePayload, serializeForPayload } from '../serialize'
import { isUniqueViolation } from '../pgErrors'

const IN_PROGRESS_KINDS = ['started', 'importing']

export class PostgresDailyMailImportBatchRepository implements DailyMailImportBatchRepository {
  constructor(private readonly db: Db) {}

  async findById(id: ImportBatchId): Promise<DailyMailImportBatch | null> {
    const rows = await this.db
      .select({ payload: dailyMailImportBatches.payload })
      .from(dailyMailImportBatches)
      .where(eq(dailyMailImportBatches.importBatchId, id))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(DailyMailImportBatchSchema, row.payload)
  }

  async findInProgressByUser(userId: UserId): Promise<DailyMailImportBatch | null> {
    // partial unique により 0..1 行
    const rows = await this.db
      .select({ payload: dailyMailImportBatches.payload })
      .from(dailyMailImportBatches)
      .where(
        and(
          eq(dailyMailImportBatches.userId, userId),
          inArray(dailyMailImportBatches.kind, IN_PROGRESS_KINDS),
        ),
      )
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(DailyMailImportBatchSchema, row.payload)
  }

  async findLatestByUser(userId: UserId): Promise<DailyMailImportBatch | null> {
    // 起動が新しい順に 1 行。`created_at` は行の挿入時刻＝バッチの起動時刻で、再開しても
    // 動かない（更新は `updated_at` 側に載る）ため「直近に起動したバッチ」の順序になる。
    // 同一ユーザーの進行中バッチは partial unique により高々 1 件なので、直近に起動した
    // ものが直近の実行に当たる
    const rows = await this.db
      .select({ payload: dailyMailImportBatches.payload })
      .from(dailyMailImportBatches)
      .where(eq(dailyMailImportBatches.userId, userId))
      // 同一時刻に 2 件並んだ場合も順序が決まるよう、ID（ULID = 生成順）を第 2 キーに置く
      .orderBy(desc(dailyMailImportBatches.createdAt), desc(dailyMailImportBatches.importBatchId))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(DailyMailImportBatchSchema, row.payload)
  }

  async save(batch: DailyMailImportBatch): Promise<void> {
    const row = {
      importBatchId: batch.common.importBatchId,
      userId: batch.common.userId,
      kind: batch.kind,
      payload: serializeForPayload(batch),
    }
    const { importBatchId: _pk, ...updateSet } = row
    try {
      await this.db
        .insert(dailyMailImportBatches)
        .values(row)
        .onConflictDoUpdate({
          target: dailyMailImportBatches.importBatchId,
          set: { ...updateSet, updatedAt: new Date() },
        })
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new InvariantViolationError(
          `日次メール取込バッチの二重起動は不可: ${batch.common.userId} には進行中バッチがある`,
          e,
        )
      }
      throw e
    }
  }
}
