/**
 * Phase0ConfigRepository の PostgreSQL 実装（システム全体で 1 件）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * シングルトンは singleton カラムの UNIQUE + CHECK が最終保証:
 * 既存と異なる ID で 2 件目を save すると unique violation になる。
 */
import type { Phase0Config, Phase0ConfigRepository } from '@warimaru/domain'
import { InvariantViolationError, Phase0ConfigSchema } from '@warimaru/domain'
import type { Db } from '../client'
import { phase0Configs } from '../schema'
import { parsePayload, serializeForPayload } from '../serialize'
import { isUniqueViolation } from '../pgErrors'

export class PostgresPhase0ConfigRepository implements Phase0ConfigRepository {
  constructor(private readonly db: Db) {}

  async find(): Promise<Phase0Config | null> {
    // singleton UNIQUE により 0..1 行
    const rows = await this.db
      .select({ payload: phase0Configs.payload })
      .from(phase0Configs)
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(Phase0ConfigSchema, row.payload)
  }

  async save(config: Phase0Config): Promise<void> {
    const row = {
      phase0ConfigId: config.phase0ConfigId,
      payload: serializeForPayload(config),
    }
    try {
      await this.db
        .insert(phase0Configs)
        .values(row)
        .onConflictDoUpdate({
          target: phase0Configs.phase0ConfigId,
          set: { payload: row.payload, updatedAt: new Date() },
        })
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new InvariantViolationError('Phase0 設定はシステム全体で 1 件のみ', e)
      }
      throw e
    }
  }
}
