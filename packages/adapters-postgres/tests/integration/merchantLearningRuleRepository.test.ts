import { describe, it, expect } from 'vitest'
import type { ActiveMerchantLearningRule, AmazonProductKey } from '@warimaru/domain'
import { AmazonProductKeySchema, disableMerchantLearning } from '@warimaru/domain'
import { db } from './setup'
import { PostgresMerchantLearningRuleRepository } from '../../src/auto-classification/PostgresMerchantLearningRuleRepository'
import { PostgresAmazonProductKeyLearningRuleRepository } from '../../src/auto-classification/PostgresAmazonProductKeyLearningRuleRepository'
import { DARLING_USER_ID, HONEY_USER_ID } from '../helpers/fixtures'
import {
  activeMerchantRule,
  amazonRule,
  disabledMerchantRule,
} from '../helpers/autoClassificationFixtures'

const repo = new PostgresMerchantLearningRuleRepository(db)

describe('PostgresMerchantLearningRuleRepository（複合自然キー PK）', () => {
  it('save → findByMerchant の往復同一性（active / disabled 両変種）', async () => {
    const active = activeMerchantRule({ merchantName: 'スーパーA' })
    const disabled = disabledMerchantRule({ merchantName: 'ストアB' })
    await repo.save(active)
    await repo.save(disabled)
    expect(await repo.findByMerchant(HONEY_USER_ID, 'スーパーA')).toEqual(active)
    expect(await repo.findByMerchant(HONEY_USER_ID, 'ストアB')).toEqual(disabled)
    expect(await repo.findByMerchant(HONEY_USER_ID, '未知ストア')).toBeNull()
  })

  it('同一 (userId, merchantName) の再 save は上書き（学習無効化の遷移）', async () => {
    const active = activeMerchantRule({ merchantName: 'スーパーA' }) as ActiveMerchantLearningRule
    await repo.save(active)
    const disabled = disableMerchantLearning(active, new Date('2026-07-03T00:00:00.000Z'))
    await repo.save(disabled)
    expect(await repo.findByMerchant(HONEY_USER_ID, 'スーパーA')).toEqual(disabled)
  })

  it('F-1: findAllByUser は本人のルールのみ返す（配偶者遮断）', async () => {
    await repo.save(activeMerchantRule({ userId: HONEY_USER_ID, merchantName: 'スーパーA' }))
    await repo.save(activeMerchantRule({ userId: DARLING_USER_ID, merchantName: 'ストアB' }))
    const rules = await repo.findAllByUser(HONEY_USER_ID)
    expect(rules).toHaveLength(1)
    expect(rules[0]?.common.merchantName).toBe('スーパーA')
  })

  it('F-1: findByMerchant も userId 起点（配偶者のルールは引けない）', async () => {
    await repo.save(activeMerchantRule({ userId: DARLING_USER_ID, merchantName: 'ストアB' }))
    expect(await repo.findByMerchant(HONEY_USER_ID, 'ストアB')).toBeNull()
  })

  it('同名加盟店でもユーザーが異なれば別ルールとして共存する', async () => {
    const honeys = activeMerchantRule({ userId: HONEY_USER_ID, merchantName: 'スーパーA' })
    const darlings = disabledMerchantRule({ userId: DARLING_USER_ID, merchantName: 'スーパーA' })
    await repo.save(honeys)
    await repo.save(darlings)
    expect(await repo.findByMerchant(HONEY_USER_ID, 'スーパーA')).toEqual(honeys)
    expect(await repo.findByMerchant(DARLING_USER_ID, 'スーパーA')).toEqual(darlings)
  })
})

describe('PostgresAmazonProductKeyLearningRuleRepository（複合自然キー PK）', () => {
  const amazonRepo = new PostgresAmazonProductKeyLearningRuleRepository(db)
  const key = (v: string): AmazonProductKey => AmazonProductKeySchema.parse(v)

  it('save → findByProductKey の往復同一性', async () => {
    const rule = amazonRule({ amazonProductKey: '本' })
    await amazonRepo.save(rule)
    expect(await amazonRepo.findByProductKey(HONEY_USER_ID, key('本'))).toEqual(rule)
    expect(await amazonRepo.findByProductKey(HONEY_USER_ID, key('家電'))).toBeNull()
  })

  it('同一 (userId, amazonProductKey) の再 save は上書き', async () => {
    await amazonRepo.save(amazonRule({ amazonProductKey: '本' }))
    const updated = amazonRule({ amazonProductKey: '本' })
    await amazonRepo.save(updated)
    expect(await amazonRepo.findByProductKey(HONEY_USER_ID, key('本'))).toEqual(updated)
  })

  it('F-1: 配偶者のルールは引けない', async () => {
    await amazonRepo.save(amazonRule({ userId: DARLING_USER_ID, amazonProductKey: '本' }))
    expect(await amazonRepo.findByProductKey(HONEY_USER_ID, key('本'))).toBeNull()
  })
})
