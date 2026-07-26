/**
 * AllowlistQuery の Neon 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * phase0_configs の payload はパス参照のみ保持するため（OQ-27）、
 * 実 LINE userID の解決は注入された ResolveParameterStoreValue が行う
 * （実 SSM 実装は application 層の責務、adapters-postgres は AWS SDK 非依存）。
 */
import type { Allowlist, AllowlistQuery } from '@warimaru/domain'
import { AllowlistSchema, NotFoundError, Phase0ConfigSchema } from '@warimaru/domain'
import type { Db } from '../client'
import { phase0Configs } from '../schema'
import { parsePayload } from '../serialize'
import type { ResolveParameterStoreValue } from '../queryDeps'

export interface NeonAllowlistQueryDeps {
  resolveParameterStoreValue: ResolveParameterStoreValue
}

export class NeonAllowlistQuery implements AllowlistQuery {
  constructor(
    private readonly db: Db,
    private readonly deps: NeonAllowlistQueryDeps,
  ) {}

  async fetch(): Promise<Allowlist> {
    const rows = await this.db
      .select({ payload: phase0Configs.payload })
      .from(phase0Configs)
      .limit(1)
    const row = rows[0]
    if (row === undefined) {
      throw new NotFoundError('Phase0Config', 'singleton')
    }
    const config = parsePayload(Phase0ConfigSchema, row.payload)
    const [honeyLineUserId, darlingLineUserId] = await Promise.all([
      this.deps.resolveParameterStoreValue(config.allowlist.honeyLineUserIdRef),
      this.deps.resolveParameterStoreValue(config.allowlist.darlingLineUserIdRef),
    ])
    return AllowlistSchema.parse({ honeyLineUserId, darlingLineUserId })
  }
}
