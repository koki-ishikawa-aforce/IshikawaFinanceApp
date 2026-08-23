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
  MerchantLearningDisabled,
  MerchantLearningReenabled,
  RetroactiveCandidateItem,
  RetroactiveCandidateQuery,
  RetroactiveReclassificationApplied,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-postgres'
import type { TestApp } from '../helpers/test-app.js'
import { createTestApp, request, SPOUSE_ID, VIEWER_ID } from '../helpers/test-app.js'

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

describe('POST /api/classification/bulk-sessions', () => {
  it('取引一覧起因（起点の取引IDなし）でセッションを開始できる', async () => {
    const t = createTestApp()
    const tx1 = await seedUnclassified(t)

    const res = await request(t.app, 'POST', '/api/classification/bulk-sessions', {
      body: { trigger: { kind: 'transaction_list' }, transactionIds: [tx1] },
    })
    expect(res.status).toBe(201)
    const created = (await res.json()) as {
      kind: string
      common: { trigger: { kind: string } }
      processedTransactionIds: string[]
      remainingCount: number
    }
    expect(created.kind).toBe('in_progress')
    expect(created.common.trigger.kind).toBe('transaction_list')
    expect(created.processedTransactionIds).toEqual([])
    expect(created.remainingCount).toBe(1)
  })
})

describe('POST /api/classification/bulk-sessions/:id/progress', () => {
  /** 対象 2 件の進行中セッションを作り、セッション ID と対象取引 ID を返す */
  async function seedSession(t: TestApp): Promise<{ sessionId: string; txIds: string[] }> {
    const tx1 = await seedUnclassified(t, '進捗ストアA')
    const tx2 = await seedUnclassified(t, '進捗ストアB')
    const createRes = await request(t.app, 'POST', '/api/classification/bulk-sessions', {
      body: { trigger: { kind: 'transaction_list' }, transactionIds: [tx1, tx2] },
    })
    expect(createRes.status).toBe(201)
    const sessionId = (
      (await createRes.json()) as { common: { bulkClassificationSessionId: string } }
    ).common.bulkClassificationSessionId
    return { sessionId, txIds: [tx1, tx2] }
  }

  it('分類し終えた対象を記録すると残件数が減り、中断してもその残件数が残る', async () => {
    const t = createTestApp()
    const { sessionId, txIds } = await seedSession(t)

    const res = await request(
      t.app,
      'POST',
      `/api/classification/bulk-sessions/${sessionId}/progress`,
      { body: { transactionIds: [txIds[0]] } },
    )
    expect(res.status).toBe(200)
    const advanced = (await res.json()) as {
      processedTransactionIds: string[]
      remainingCount: number
    }
    expect(advanced.processedTransactionIds).toEqual([txIds[0]])
    expect(advanced.remainingCount).toBe(1)

    const abortRes = await request(
      t.app,
      'POST',
      `/api/classification/bulk-sessions/${sessionId}/abort`,
    )
    expect(abortRes.status).toBe(200)
    expect((await abortRes.json()) as { remainingCount: number }).toMatchObject({
      remainingCount: 1,
    })
  })

  it('同じ要求を再送しても残件数は二重に減らない', async () => {
    const t = createTestApp()
    const { sessionId, txIds } = await seedSession(t)

    for (let i = 0; i < 2; i++) {
      const res = await request(
        t.app,
        'POST',
        `/api/classification/bulk-sessions/${sessionId}/progress`,
        { body: { transactionIds: [txIds[0]] } },
      )
      expect(res.status).toBe(200)
      expect((await res.json()) as { remainingCount: number }).toMatchObject({ remainingCount: 1 })
    }
  })

  it('配偶者のセッションの進捗は記録できない', async () => {
    const t = createTestApp()
    const { sessionId, txIds } = await seedSession(t)

    const res = await request(
      t.app,
      'POST',
      `/api/classification/bulk-sessions/${sessionId}/progress`,
      { body: { transactionIds: [txIds[0]] }, viewerId: SPOUSE_ID },
    )
    expect(res.status).toBe(403)

    // 拒否された要求でセッションの残件数が動いていないこと
    const getRes = await request(t.app, 'GET', `/api/classification/bulk-sessions/${sessionId}`)
    expect((await getRes.json()) as { remainingCount: number }).toMatchObject({ remainingCount: 2 })
  })

  it('終端状態（中断済み）のセッションには進捗を記録できない', async () => {
    const t = createTestApp()
    const { sessionId, txIds } = await seedSession(t)
    expect(
      (await request(t.app, 'POST', `/api/classification/bulk-sessions/${sessionId}/abort`)).status,
    ).toBe(200)

    const res = await request(
      t.app,
      'POST',
      `/api/classification/bulk-sessions/${sessionId}/progress`,
      { body: { transactionIds: [txIds[0]] } },
    )
    expect(res.status).toBeGreaterThanOrEqual(400)
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

  it('無効化された加盟店ルールは遡及適用できない（409）', async () => {
    const merchantName = '無効化ストア'
    const retroactiveCandidateQuery: RetroactiveCandidateQuery = {
      async fetchCandidates(userId, name) {
        return { userId, merchantName: name, candidates: [], proposedAt: new Date() }
      },
    }
    const t = createTestApp({ retroactiveCandidateQuery })
    await seedLearnedRule(t, merchantName)

    const disableRes = await request(t.app, 'POST', '/api/classification/merchant-rules/disable', {
      body: { merchantName },
    })
    expect(disableRes.status).toBe(200)

    const applyRes = await request(
      t.app,
      'POST',
      '/api/classification/retroactive-candidates/apply',
      {
        body: { merchantName },
      },
    )
    expect(applyRes.status).toBe(409)
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

interface MerchantRulesResponse {
  items: { kind: string; common: { merchantName: string } }[]
}

async function fetchRule(t: TestApp, merchantName: string): Promise<{ kind: string } | undefined> {
  const res = await request(t.app, 'GET', '/api/classification/merchant-rules')
  const { items } = (await res.json()) as MerchantRulesResponse
  return items.find(item => item.common.merchantName === merchantName)
}

describe('POST /api/classification/merchant-rules/disable', () => {
  it('有効な加盟店ルールを学習無効化へ遷移させ、MerchantLearningDisabled を発火する（M-1、08b §2/§3）', async () => {
    const merchantName = '学習停止ストア'
    const t = createTestApp()
    await seedLearnedRule(t, merchantName)

    const events: MerchantLearningDisabled[] = []
    t.deps.eventBus.subscribe<MerchantLearningDisabled>('MerchantLearningDisabled', e => {
      events.push(e)
    })

    const res = await request(t.app, 'POST', '/api/classification/merchant-rules/disable', {
      body: { merchantName },
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { kind: string }).kind).toBe('disabled')
    expect((await fetchRule(t, merchantName))?.kind).toBe('disabled')
    expect(events).toHaveLength(1)
    expect(events[0]?.userId).toBe(VIEWER_ID)
    expect(events[0]?.merchantName).toBe(merchantName)
  })

  it('無効化後は手動修正が学習に反映されず、加盟店は未分類のまま（学習が復活しない）', async () => {
    const merchantName = '据え置きストア'
    const t = createTestApp()
    await seedLearnedRule(t, merchantName)
    await request(t.app, 'POST', '/api/classification/merchant-rules/disable', {
      body: { merchantName },
    })

    // 無効化中の加盟店の取引を手動分類しても、学習ルールは disabled のまま復活しない
    const txId = await seedUnclassified(t, merchantName)
    const classifyRes = await request(t.app, 'PUT', `/api/transactions/${txId}/classify`, {
      body: { categoryId: newUlid(), expenseClass: 'household' },
    })
    expect(classifyRes.status).toBe(200)

    expect((await fetchRule(t, merchantName))?.kind).toBe('disabled')
  })

  it('学習ルールが存在しない加盟店の無効化は 404', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'POST', '/api/classification/merchant-rules/disable', {
      body: { merchantName: '未学習ストア' },
    })
    expect(res.status).toBe(404)
  })

  it('F-1: 他ユーザーの学習ルールには触れられない（自分のスコープに無ければ 404）', async () => {
    const merchantName = '相手ストア'
    const t = createTestApp()
    await seedLearnedRule(t, merchantName) // VIEWER_ID のルール

    // SPOUSE_ID の視点では自分の学習ルールが無いため 404
    const res = await request(t.app, 'POST', '/api/classification/merchant-rules/disable', {
      body: { merchantName },
      viewerId: SPOUSE_ID,
    })
    expect(res.status).toBe(404)
    // VIEWER_ID のルールは無効化されず有効なまま
    expect((await fetchRule(t, merchantName))?.kind).toBe('active')
  })

  it('無効化は冪等（無効化済みでは 200 で disabled を返し、イベントは再発火しない）', async () => {
    const merchantName = '二重無効化ストア'
    const t = createTestApp()
    await seedLearnedRule(t, merchantName)
    await request(t.app, 'POST', '/api/classification/merchant-rules/disable', {
      body: { merchantName },
    })

    // 2 回目以降のみを観測する（状態遷移が無いのでイベントは発火しない）
    const events: MerchantLearningDisabled[] = []
    t.deps.eventBus.subscribe<MerchantLearningDisabled>('MerchantLearningDisabled', e => {
      events.push(e)
    })

    const res = await request(t.app, 'POST', '/api/classification/merchant-rules/disable', {
      body: { merchantName },
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { kind: string }).kind).toBe('disabled')
    expect(events).toHaveLength(0)
  })
})

describe('POST /api/classification/merchant-rules/reenable', () => {
  it('無効化された加盟店ルールを再有効化し、全軸未学習に戻す', async () => {
    const merchantName = '再開ストア'
    const t = createTestApp()
    await seedLearnedRule(t, merchantName)
    await request(t.app, 'POST', '/api/classification/merchant-rules/disable', {
      body: { merchantName },
    })

    const events: MerchantLearningReenabled[] = []
    t.deps.eventBus.subscribe<MerchantLearningReenabled>('MerchantLearningReenabled', e => {
      events.push(e)
    })

    const res = await request(t.app, 'POST', '/api/classification/merchant-rules/reenable', {
      body: { merchantName },
    })
    expect(res.status).toBe(200)
    const rule = (await res.json()) as {
      kind: string
      categoryRef: { kind: string }
      expenseClassRef: { kind: string }
      expenseTypeRef: { kind: string }
    }
    expect(rule.kind).toBe('active')
    expect(rule.categoryRef.kind).toBe('unlearned')
    expect(rule.expenseClassRef.kind).toBe('unlearned')
    expect(rule.expenseTypeRef.kind).toBe('unlearned')
    expect(events).toHaveLength(1)
    expect(events[0]?.userId).toBe(VIEWER_ID)
    expect(events[0]?.merchantName).toBe(merchantName)
  })

  it('学習ルールが存在しない加盟店の再有効化は 404', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'POST', '/api/classification/merchant-rules/reenable', {
      body: { merchantName: '未学習ストア' },
    })
    expect(res.status).toBe(404)
  })

  it('再有効化は冪等（有効なルールは学習済み軸を消さず 200 で返し、イベントも発火しない）', async () => {
    const merchantName = '有効据え置きストア'
    const t = createTestApp()
    await seedLearnedRule(t, merchantName) // category と expenseClass は学習済み

    const events: MerchantLearningReenabled[] = []
    t.deps.eventBus.subscribe<MerchantLearningReenabled>('MerchantLearningReenabled', e => {
      events.push(e)
    })

    const res = await request(t.app, 'POST', '/api/classification/merchant-rules/reenable', {
      body: { merchantName },
    })
    expect(res.status).toBe(200)
    const rule = (await res.json()) as {
      kind: string
      categoryRef: { kind: string }
    }
    expect(rule.kind).toBe('active')
    // 学習済みカテゴリ軸が消えていない（active への再有効化は破壊的にしない）
    expect(rule.categoryRef.kind).toBe('learned')
    // 状態遷移が無いためイベントは発火しない
    expect(events).toHaveLength(0)
  })
})
