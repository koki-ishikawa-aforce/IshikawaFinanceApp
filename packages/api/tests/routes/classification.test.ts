import { describe, it, expect } from 'vitest'
import {
  CategoryIdSchema,
  MerchantLearningRuleSchema,
  MoneySchema,
  TransactionIdSchema,
  TransactionSchema,
} from '@warimaru/domain'
import type {
  BulkClassificationCompleted,
  RetroactiveCandidateItem,
  RetroactiveCandidateQuery,
  RetroactiveReclassificationApplied,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-neon'
import type { TestApp } from '../helpers/test-app.js'
import { createTestApp, request, VIEWER_ID } from '../helpers/test-app.js'

async function seedUnclassified(t: TestApp, merchantName = '未分類ストア'): Promise<string> {
  const transactionId = TransactionIdSchema.parse(newUlid())
  await t.deps.transactionRepository.save(
    TransactionSchema.parse({
      kind: 'unclassified',
      common: {
        transactionId,
        ownerUserId: VIEWER_ID,
        merchantName,
        amount: 800,
        occurredAt: new Date('2026-07-10T03:00:00Z'),
        importSource: {
          kind: 'manual',
          enteredAt: new Date('2026-07-10T04:00:00Z'),
          enteredByUserId: VIEWER_ID,
        },
      },
      reason: 'merchant_rule_unlearned',
      defaultExpenseClass: 'personal_darling',
    }),
  )
  return transactionId
}

/** 学習済み（active）加盟店ルールを用意する（カテゴリ・費用区分は学習済み、非経費のため経費種別は未学習） */
async function seedLearnedRule(t: TestApp, merchantName: string): Promise<void> {
  await t.deps.merchantLearningRuleRepository.save(
    MerchantLearningRuleSchema.parse({
      kind: 'active',
      common: { userId: VIEWER_ID, merchantName },
      categoryRef: { kind: 'learned', categoryId: CategoryIdSchema.parse(newUlid()) },
      expenseClassRef: { kind: 'learned', expenseClass: 'household' },
      expenseTypeRef: { kind: 'unlearned' },
      lastUpdatedAt: new Date('2026-07-01T00:00:00Z'),
    }),
  )
}

describe('POST /api/classification/bulk-sessions/:id/complete', () => {
  it('processedCount は対象取引の実状態からサーバー側で算出される', async () => {
    const t = createTestApp()
    const tx1 = await seedUnclassified(t)
    const tx2 = await seedUnclassified(t)

    const createRes = await request(t.app, 'POST', '/api/classification/bulk-sessions', {
      body: {
        trigger: { kind: 'single_correction', transactionId: tx1 },
        transactionIds: [tx1, tx2],
      },
    })
    expect(createRes.status).toBe(201)
    const sessionId = (
      (await createRes.json()) as { common: { bulkClassificationSessionId: string } }
    ).common.bulkClassificationSessionId

    // tx1 のみ分類してから完了する（body は送らない）
    const classifyRes = await request(t.app, 'PUT', `/api/transactions/${tx1}/classify`, {
      body: { categoryId: newUlid(), expenseClass: 'household' },
    })
    expect(classifyRes.status).toBe(200)

    const completeRes = await request(
      t.app,
      'POST',
      `/api/classification/bulk-sessions/${sessionId}/complete`,
    )
    expect(completeRes.status).toBe(200)
    const completed = (await completeRes.json()) as { kind: string; processedCount: number }
    expect(completed.kind).toBe('completed')
    expect(completed.processedCount).toBe(1)
  })

  it('セッション完了時に BulkClassificationCompleted を発火する（08b §3 N-1）', async () => {
    const t = createTestApp()
    const tx1 = await seedUnclassified(t)
    const createRes = await request(t.app, 'POST', '/api/classification/bulk-sessions', {
      body: {
        trigger: { kind: 'single_correction', transactionId: tx1 },
        transactionIds: [tx1],
      },
    })
    const sessionId = (
      (await createRes.json()) as { common: { bulkClassificationSessionId: string } }
    ).common.bulkClassificationSessionId

    const events: BulkClassificationCompleted[] = []
    t.deps.eventBus.subscribe<BulkClassificationCompleted>('BulkClassificationCompleted', e => {
      events.push(e)
    })

    // 1 件も分類せず完了しても、完了そのものがイベントなので処理件数 0 で発火する
    const completeRes = await request(
      t.app,
      'POST',
      `/api/classification/bulk-sessions/${sessionId}/complete`,
    )
    expect(completeRes.status).toBe(200)
    expect(events).toHaveLength(1)
    expect(events[0]?.bulkClassificationSessionId).toBe(sessionId)
    expect(events[0]?.processedCount).toBe(0)
  })
})

describe('POST /api/classification/retroactive-candidates/apply', () => {
  it('遡及適用で取引が再分類されると RetroactiveReclassificationApplied を発火する（08b §3 J-3）', async () => {
    const merchantName = '遡及ストア'
    const candidates: RetroactiveCandidateItem[] = []
    const retroactiveCandidateQuery: RetroactiveCandidateQuery = {
      async fetchCandidates(userId, name) {
        return { userId, merchantName: name, candidates, proposedAt: new Date() }
      },
    }
    const t = createTestApp({ retroactiveCandidateQuery })
    await seedLearnedRule(t, merchantName)

    const tx1 = await seedUnclassified(t, merchantName)
    const tx2 = await seedUnclassified(t, merchantName)
    candidates.push(
      {
        transactionId: TransactionIdSchema.parse(tx1),
        occurredAt: new Date(),
        amount: MoneySchema.parse(800),
      },
      {
        transactionId: TransactionIdSchema.parse(tx2),
        occurredAt: new Date(),
        amount: MoneySchema.parse(800),
      },
    )

    const events: RetroactiveReclassificationApplied[] = []
    t.deps.eventBus.subscribe<RetroactiveReclassificationApplied>(
      'RetroactiveReclassificationApplied',
      e => {
        events.push(e)
      },
    )

    const res = await request(t.app, 'POST', '/api/classification/retroactive-candidates/apply', {
      body: { merchantName },
    })
    expect(res.status).toBe(200)
    const { appliedCount } = (await res.json()) as { appliedCount: number }
    expect(appliedCount).toBe(2)
    expect(events).toHaveLength(1)
    expect(events[0]?.userId).toBe(VIEWER_ID)
    expect(events[0]?.targetCount).toBe(2)
  })

  it('適用対象が 0 件のときはイベントを発火しない', async () => {
    const merchantName = '遡及ゼロストア'
    const retroactiveCandidateQuery: RetroactiveCandidateQuery = {
      async fetchCandidates(userId, name) {
        return { userId, merchantName: name, candidates: [], proposedAt: new Date() }
      },
    }
    const t = createTestApp({ retroactiveCandidateQuery })
    await seedLearnedRule(t, merchantName)

    const events: RetroactiveReclassificationApplied[] = []
    t.deps.eventBus.subscribe<RetroactiveReclassificationApplied>(
      'RetroactiveReclassificationApplied',
      e => {
        events.push(e)
      },
    )

    const res = await request(t.app, 'POST', '/api/classification/retroactive-candidates/apply', {
      body: { merchantName },
    })
    expect(res.status).toBe(200)
    expect(events).toHaveLength(0)
  })
})
