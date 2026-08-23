/**
 * 取引分類 → 学習ルール更新チェーンのハンドラーテスト（#34）
 *
 * TransactionManuallyClassified をバスへ直接 publish し、加盟店学習ルールへ
 * 反映されること・再配信で二重書きしないこと・AMAZON.CO.JP は学習されないことを検証する。
 * X-1（Amazon 商品キー学習）は 2026-08-23 に取り下げたため、Amazon の取引はどの
 * 学習ルールにも記録されない（#391・#572）。
 */
import { describe, it, expect } from 'vitest'
import {
  CategoryIdSchema,
  TransactionIdSchema,
  TransactionManuallyClassifiedSchema,
  type LearningRuleUpdated,
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
    merchantName: 'スーパーA',
    confirmedClassification: { categoryId: CATEGORY_ID, expenseClass: 'household' },
    ...overrides,
  })
}

describe('registerAutoClassificationEventHandlers', () => {
  it('手動分類の確定を加盟店学習ルールへ反映し、更新軸ごとにイベントを発火する', async () => {
    const t = createTestApp()
    const updated: LearningRuleUpdated[] = []
    t.deps.eventBus.subscribe<LearningRuleUpdated>('LearningRuleUpdated', e => {
      updated.push(e)
    })

    await t.deps.eventBus.publish(manuallyClassified())

    const rule = await t.deps.merchantLearningRuleRepository.findByMerchant(VIEWER_ID, 'スーパーA')
    expect(rule?.kind).toBe('active')
    expect(rule?.kind === 'active' && rule.categoryRef).toEqual({
      kind: 'learned',
      categoryId: CATEGORY_ID,
    })
    // カテゴリ・費用区分の 2 軸が未学習から学習済みへ変わる（T-2 軸独立）
    expect(updated.map(e => e.axis).sort()).toEqual(['category', 'expense_class'])
  })

  it('冪等: 同一加盟店・同一分類の再配信では二重書きせず追加イベントも出さない', async () => {
    const t = createTestApp()
    const updated: LearningRuleUpdated[] = []
    t.deps.eventBus.subscribe<LearningRuleUpdated>('LearningRuleUpdated', e => {
      updated.push(e)
    })

    await t.deps.eventBus.publish(manuallyClassified())
    // 後から届いた再配信（at-least-once）。値は同じで発生日時だけが後
    await t.deps.eventBus.publish(
      manuallyClassified({
        eventId: newUlid(),
        occurredAt: new Date('2026-07-26T00:00:00Z'),
      }),
    )

    // 2 回目は値が変わらないため unchanged となり、イベントは 1 巡分のみ
    expect(updated).toHaveLength(2)
    // 保存もされない: 最終更新日時が後着の発生日時で上書きされていない
    // （上書きすると画面の「最終更新日」が実際に学習した日とずれる）
    const rule = await t.deps.merchantLearningRuleRepository.findByMerchant(VIEWER_ID, 'スーパーA')
    expect(rule?.kind === 'active' && rule.lastUpdatedAt).toEqual(new Date('2026-07-25T00:00:00Z'))
  })

  it('AMAZON.CO.JP の確定は学習ルールを作らない（X-1 取り下げ後は学習経路が無い）', async () => {
    const t = createTestApp()
    const updated: LearningRuleUpdated[] = []
    t.deps.eventBus.subscribe<LearningRuleUpdated>('LearningRuleUpdated', e => {
      updated.push(e)
    })

    await t.deps.eventBus.publish(manuallyClassified({ merchantName: 'AMAZON.CO.JP' }))

    const rule = await t.deps.merchantLearningRuleRepository.findByMerchant(
      VIEWER_ID,
      'AMAZON.CO.JP',
    )
    expect(rule).toBeNull()
    expect(updated).toHaveLength(0)
  })
})
