/**
 * LineChannelConfigQuery の PostgreSQL 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * 返すのはパス参照を含む設定 VO そのもの（実値解決は使用側の責務）。
 */
import type { LineChannelConfig, LineChannelConfigQuery } from '@warimaru/domain'
import { NotFoundError, Phase0ConfigSchema } from '@warimaru/domain'
import type { Db } from '../client'
import { phase0Configs } from '../schema'
import { parsePayload } from '../serialize'

export class PostgresLineChannelConfigQuery implements LineChannelConfigQuery {
  constructor(private readonly db: Db) {}

  async fetch(): Promise<LineChannelConfig> {
    const rows = await this.db
      .select({ payload: phase0Configs.payload })
      .from(phase0Configs)
      .limit(1)
    const row = rows[0]
    if (row === undefined) {
      throw new NotFoundError('Phase0Config', 'singleton')
    }
    return parsePayload(Phase0ConfigSchema, row.payload).lineChannel
  }
}
