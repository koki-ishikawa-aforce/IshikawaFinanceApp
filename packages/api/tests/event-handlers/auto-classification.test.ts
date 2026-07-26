/**
 * 取引分類 → 学習ルール更新チェーンのハンドラーテスト（#34 / X-1 配線 #103）
 *
 * TransactionManuallyClassified をバスへ直接 publish し、商品キーの有無で
 * 加盟店学習 / Amazon商品キー学習 の経路が分かれることを検証する。
 * 実際の商品キー供給経路（家計分析の取引が商品キーを知る手段）はスコープ外のため、
 * ここではイベントに商品キーを与えて配線を確認する。
 */
import { describe, it, expect } from 'vitest'
import {
  AmazonProductKeySchema,
  CategoryIdSchema,
  TransactionIdSchema,
  TransactionManuallyClassifiedSchema,
  type AmazonProductKeyMappingRegistered,
  type TransactionManuallyClassified,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-postgres'
import { createTestApp, VIEWER_ID } from '../helpers/test-app.js'

const CATEGORY_ID = CategoryIdSchema.parse(newUlid())

function manuallyClassified(
  overrides: Partial<TransactionManuallyClassified> = {},
): TransactionManuallyClassified {
  return TransactionManuallyClassifiedSchema.parse({
    eventId: newUlid(),
    occurredAt: new Date('2026-07-25T00:00:00Z'),
    type: 'TransactionManuallyClassified',
    transactionId: TransactionIdSchema.parse(newUlid()),
    userId: VIEWER_ID,
    merchantName: 'AMAZON.CO.JP',
    confirmedClassification: { categoryId: CATEGORY_ID, expenseClass: 'household' },
    ...overrides,
  })
}

describe('registerAutoClassificationEventHandlers（X-1 配線）', () => {
  it('商品キー付きの手動分類は Amazon商品キー学習ルールへ書き込み、加盟店学習は触らない', async () => {
    const t = createTestApp()
    const amazonProductKey = AmazonProductKeySchema.parse('本')
    const registered: AmazonProductKeyMappingRegistered[] = []
    t.deps.eventBus.subscribe<AmazonProductKeyMappingRegistered>(
      'AmazonProductKeyMappingRegistered',
      e => {
        registered.push(e)
      },
    )

    await t.deps.eventBus.publish(manuallyClassified({ amazonProductKey }))

    const rule = await t.deps.amazonProductKeyLearningRuleRepository.findByProductKey(
      VIEWER_ID,
      amazonProductKey,
    )
    expect(rule).not.toBeNull()
    expect(rule?.categoryRef).toEqual({ kind: 'learned', categoryId: CATEGORY_ID })
    expect(rule?.expenseClassRef).toEqual({ kind: 'learned', expenseClass: 'household' })
    // AmazonProductKeyMappingRegistered が発火する
    expect(registered).toHaveLength(1)
    expect(registered[0]?.amazonProductKey).toBe(amazonProductKey)
    // 加盟店学習ルール（AMAZON.CO.JP）は作られない（X-1: 加盟店学習の対象外）
    const merchant = await t.deps.merchantLearningRuleRepository.findByMerchant(
      VIEWER_ID,
      'AMAZON.CO.JP',
    )
    expect(merchant).toBeNull()
  })

  it('冪等: 同一商品キー・同一分類の再配信では二重書きせず追加イベントも出さない', async () => {
    const t = createTestApp()
    const amazonProductKey = AmazonProductKeySchema.parse('本')
    const registered: AmazonProductKeyMappingRegistered[] = []
    t.deps.eventBus.subscribe<AmazonProductKeyMappingRegistered>(
      'AmazonProductKeyMappingRegistered',
      e => {
        registered.push(e)
      },
    )

    await t.deps.eventBus.publish(manuallyClassified({ amazonProductKey }))
    await t.deps.eventBus.publish(manuallyClassified({ amazonProductKey }))

    // 2 回目は値が変わらないため unchanged となり、イベントは 1 回のみ
    expect(registered).toHaveLength(1)
  })

  it('商品キーなしの手動分類は従来どおり加盟店学習ルールへ反映する（後方互換）', async () => {
    const t = createTestApp()

    await t.deps.eventBus.publish(
      manuallyClassified({ merchantName: 'スーパーA', amazonProductKey: undefined }),
    )

    const merchant = await t.deps.merchantLearningRuleRepository.findByMerchant(
      VIEWER_ID,
      'スーパーA',
    )
    expect(merchant?.kind).toBe('active')
    // Amazon商品キー学習ルールには何も書かれない
    const amazonRules = await t.deps.amazonProductKeyLearningRuleRepository.findAllByUser(VIEWER_ID)
    expect(amazonRules).toHaveLength(0)
  })
})
