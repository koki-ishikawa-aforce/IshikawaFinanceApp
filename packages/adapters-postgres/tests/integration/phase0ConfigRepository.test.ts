import { describe, it, expect } from 'vitest'
import type { ParameterStorePath } from '@warimaru/domain'
import { InvariantViolationError, NotFoundError, Phase0ConfigSchema } from '@warimaru/domain'
import { db } from './setup'
import { PostgresPhase0ConfigRepository } from '../../src/master-data/PostgresPhase0ConfigRepository'
import { PostgresAllowlistQuery } from '../../src/master-data/PostgresAllowlistQuery'
import { PostgresLineChannelConfigQuery } from '../../src/master-data/PostgresLineChannelConfigQuery'
import type { ResolveParameterStoreValue } from '../../src/queryDeps'
import { phase0Config } from '../helpers/masterDataFixtures'

const repo = new PostgresPhase0ConfigRepository(db)

/** Parameter Store のパス末尾から決め打ちの LINE userID を返すスタブ */
const stubResolveParameterStoreValue: ResolveParameterStoreValue = (path: ParameterStorePath) =>
  Promise.resolve(path.includes('husband') ? 'U-honey-from-ssm' : 'U-darling-from-ssm')

describe('PostgresPhase0ConfigRepository（シングルトン）', () => {
  it('未投入なら find は null', async () => {
    expect(await repo.find()).toBeNull()
  })

  it('save → find の往復同一性', async () => {
    const config = phase0Config()
    await repo.save(config)
    expect(await repo.find()).toEqual(config)
  })

  it('同一 ID の再 save は上書き（更新）できる', async () => {
    const config = phase0Config()
    await repo.save(config)
    const updated = Phase0ConfigSchema.parse({
      ...config,
      lineWebhook: { ...config.lineWebhook, webhookUrl: 'https://example.com/webhook-v2' },
    })
    await repo.save(updated)
    expect(await repo.find()).toEqual(updated)
  })

  it('別 ID の 2 件目 save は InvariantViolationError（singleton UNIQUE）', async () => {
    await repo.save(phase0Config())
    await expect(repo.save(phase0Config())).rejects.toThrow(InvariantViolationError)
  })
})

describe('PostgresLineChannelConfigQuery', () => {
  it('未投入なら NotFoundError', async () => {
    await expect(new PostgresLineChannelConfigQuery(db).fetch()).rejects.toThrow(NotFoundError)
  })

  it('payload の lineChannel（パス参照のまま）を返す', async () => {
    const config = phase0Config()
    await repo.save(config)
    expect(await new PostgresLineChannelConfigQuery(db).fetch()).toEqual(config.lineChannel)
  })
})

describe('PostgresAllowlistQuery', () => {
  const query = new PostgresAllowlistQuery(db, {
    resolveParameterStoreValue: stubResolveParameterStoreValue,
  })

  it('未投入なら NotFoundError', async () => {
    await expect(query.fetch()).rejects.toThrow(NotFoundError)
  })

  it('パス参照を実値に解決した Allowlist を返す', async () => {
    await repo.save(phase0Config())
    expect(await query.fetch()).toEqual({
      honeyLineUserId: 'U-honey-from-ssm',
      darlingLineUserId: 'U-darling-from-ssm',
    })
  })
})
