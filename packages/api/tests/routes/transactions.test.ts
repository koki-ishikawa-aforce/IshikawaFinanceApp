import { describe, it, expect } from 'vitest'
import { TransactionIdSchema } from '@warimaru/domain'
import type {
  LearningRuleUpdated,
  TransactionListQuery,
  TransactionListFilter,
  TransactionManuallyClassified,
  UserId,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-neon'
import type { TestApp } from '../helpers/test-app.js'
import { createTestApp, request, SPOUSE_ID, VIEWER_ID } from '../helpers/test-app.js'

async function createUnclassified(t: TestApp, viewerId: UserId = VIEWER_ID): Promise<string> {
  const res = await request(t.app, 'POST', '/api/transactions', {
    body: { merchantName: 'スーパーA', amount: 1200, occurredAt: '2026-07-05T03:00:00Z' },
    viewerId,
  })
  expect(res.status).toBe(201)
  return ((await res.json()) as { common: { transactionId: string } }).common.transactionId
}

describe('GET /api/transactions', () => {
  it('クエリパラメータが viewer 付きの TransactionListFilter に変換される', async () => {
    const calls: { viewerId: UserId; filter: TransactionListFilter }[] = []
    const stub: TransactionListQuery = {
      async fetch(viewerId, filter) {
        calls.push({ viewerId, filter })
        return []
      },
      async fetchUnclassifiedSummary() {
        return { count: 0, recentIds: [] }
      },
    }
    const t = createTestApp({ transactionListQuery: stub })
    const res = await request(
      t.app,
      'GET',
      '/api/transactions?month=2026-07&expenseClass=household&isUnclassifiedOnly=true',
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.viewerId).toBe(VIEWER_ID)
    expect(calls[0]?.filter).toEqual({
      month: '2026-07',
      expenseClass: 'household',
      isUnclassifiedOnly: true,
    })
  })

  it('month 未指定は 400', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/transactions')
    expect(res.status).toBe(400)
  })

  it('expenseClass が不正な値なら 400', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/transactions?month=2026-07&expenseClass=food')
    expect(res.status).toBe(400)
  })
})

describe('GET /api/transactions/unclassified-summary', () => {
  it('未分類サマリーを返す', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/transactions/unclassified-summary?month=2026-07')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ count: 0, recentIds: [] })
  })

  it('month 未指定は 400', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/transactions/unclassified-summary')
    expect(res.status).toBe(400)
  })
})

describe('POST /api/transactions', () => {
  it('分類なしは未分類取引になり、ロール既定の費目区分が入る', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'POST', '/api/transactions', {
      body: { merchantName: 'ｽｰﾊﾟｰＡ', amount: 1200, occurredAt: '2026-07-05T03:00:00Z' },
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      kind: string
      defaultExpenseClass: string
      common: { transactionId: string; merchantName: string; ownerUserId: string }
    }
    expect(body.kind).toBe('unclassified')
    // VIEWER_ID (user-honey-test) は honey に解決され、既定区分は personal_honey になる
    expect(body.defaultExpenseClass).toBe('personal_honey')
    // NFKC 正規化: 半角カナ・全角英数が正規化される
    expect(body.common.merchantName).toBe('スーパーA')
    expect(body.common.ownerUserId).toBe(VIEWER_ID)
    const saved = await t.deps.transactionRepository.findById(
      TransactionIdSchema.parse(body.common.transactionId),
    )
    expect(saved?.kind).toBe('unclassified')
  })

  it('分類ありは分類済み取引になる（basis は user_manual）', async () => {
    const t = createTestApp()
    const categoryId = newUlid()
    const res = await request(t.app, 'POST', '/api/transactions', {
      body: {
        merchantName: 'カフェB',
        amount: 800,
        occurredAt: '2026-07-06T01:00:00Z',
        classification: { categoryId, expenseClass: 'household' },
      },
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      kind: string
      details: { categoryId: string; basis: { kind: string } }
    }
    expect(body.kind).toBe('classified')
    expect(body.details.categoryId).toBe(categoryId)
    expect(body.details.basis.kind).toBe('user_manual')
  })

  it('business_expense の分類で expenseTypeId がなければ 400', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'POST', '/api/transactions', {
      body: {
        merchantName: '書店C',
        amount: 3000,
        occurredAt: '2026-07-06T01:00:00Z',
        classification: { categoryId: newUlid(), expenseClass: 'business_expense' },
      },
    })
    expect(res.status).toBe(400)
  })

  it('金額 0 は 400', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'POST', '/api/transactions', {
      body: { merchantName: 'スーパーA', amount: 0, occurredAt: '2026-07-05T03:00:00Z' },
    })
    expect(res.status).toBe(400)
  })
})

describe('PUT /api/transactions/:id', () => {
  it('本人の取引のフィールドを更新できる', async () => {
    const t = createTestApp()
    const id = await createUnclassified(t)
    const res = await request(t.app, 'PUT', `/api/transactions/${id}`, {
      body: { amount: -500, merchantName: '返金D' },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { common: { amount: number; merchantName: string } }
    expect(body.common.amount).toBe(-500)
    expect(body.common.merchantName).toBe('返金D')
  })

  it('更新フィールドが 1 つもないボディは 400', async () => {
    const t = createTestApp()
    const id = await createUnclassified(t)
    const res = await request(t.app, 'PUT', `/api/transactions/${id}`, { body: {} })
    expect(res.status).toBe(400)
  })

  it('存在しない取引は 404', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'PUT', `/api/transactions/${newUlid()}`, {
      body: { amount: 100 },
    })
    expect(res.status).toBe(404)
  })

  it('他ユーザーの取引の更新は 403', async () => {
    const t = createTestApp()
    const id = await createUnclassified(t, SPOUSE_ID)
    const res = await request(t.app, 'PUT', `/api/transactions/${id}`, {
      body: { amount: 100 },
    })
    expect(res.status).toBe(403)
  })

  it('削除済み取引の更新は 409', async () => {
    const t = createTestApp()
    const id = await createUnclassified(t)
    await request(t.app, 'DELETE', `/api/transactions/${id}`)
    const res = await request(t.app, 'PUT', `/api/transactions/${id}`, {
      body: { amount: 100 },
    })
    expect(res.status).toBe(409)
  })
})

describe('DELETE /api/transactions/:id', () => {
  it('本人の取引を論理削除できる', async () => {
    const t = createTestApp()
    const id = await createUnclassified(t)
    const res = await request(t.app, 'DELETE', `/api/transactions/${id}`)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { kind: string }).kind).toBe('deleted')
  })

  it('削除済み取引の再削除は冪等に 200 で現状を返す', async () => {
    const t = createTestApp()
    const id = await createUnclassified(t)
    await request(t.app, 'DELETE', `/api/transactions/${id}`)
    const res = await request(t.app, 'DELETE', `/api/transactions/${id}`)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { kind: string }).kind).toBe('deleted')
  })

  it('他ユーザーの取引の削除は 403', async () => {
    const t = createTestApp()
    const id = await createUnclassified(t, SPOUSE_ID)
    const res = await request(t.app, 'DELETE', `/api/transactions/${id}`)
    expect(res.status).toBe(403)
  })

  it('存在しない取引は 404', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'DELETE', `/api/transactions/${newUlid()}`)
    expect(res.status).toBe(404)
  })
})

describe('PUT /api/transactions/:id/classify', () => {
  it('未分類取引を手動分類できる', async () => {
    const t = createTestApp()
    const id = await createUnclassified(t)
    const categoryId = newUlid()
    const res = await request(t.app, 'PUT', `/api/transactions/${id}/classify`, {
      body: { categoryId, expenseClass: 'household' },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { kind: string; details: { categoryId: string } }
    expect(body.kind).toBe('classified')
    expect(body.details.categoryId).toBe(categoryId)
  })

  it('分類済み取引の再分類で分類が上書きされる', async () => {
    const t = createTestApp()
    const id = await createUnclassified(t)
    await request(t.app, 'PUT', `/api/transactions/${id}/classify`, {
      body: { categoryId: newUlid(), expenseClass: 'household' },
    })
    const newCategoryId = newUlid()
    const res = await request(t.app, 'PUT', `/api/transactions/${id}/classify`, {
      body: { categoryId: newCategoryId, expenseClass: 'personal_darling' },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      details: { categoryId: string; expenseClass: string }
    }
    expect(body.details.categoryId).toBe(newCategoryId)
    expect(body.details.expenseClass).toBe('personal_darling')
  })

  it('削除済み取引の分類は 409', async () => {
    const t = createTestApp()
    const id = await createUnclassified(t)
    await request(t.app, 'DELETE', `/api/transactions/${id}`)
    const res = await request(t.app, 'PUT', `/api/transactions/${id}/classify`, {
      body: { categoryId: newUlid(), expenseClass: 'household' },
    })
    expect(res.status).toBe(409)
  })
})

describe('取引分類 → 学習ルール更新チェーン（#34）', () => {
  it('手動分類で加盟店学習ルールへ即時反映される（I-1）', async () => {
    const t = createTestApp()
    const id = await createUnclassified(t)
    const categoryId = newUlid()
    const res = await request(t.app, 'PUT', `/api/transactions/${id}/classify`, {
      body: { categoryId, expenseClass: 'household' },
    })
    expect(res.status).toBe(200)
    const rule = await t.deps.merchantLearningRuleRepository.findByMerchant(VIEWER_ID, 'スーパーA')
    expect(rule?.kind).toBe('active')
    if (rule?.kind !== 'active') return
    expect(rule.categoryRef).toEqual({ kind: 'learned', categoryId })
    expect(rule.expenseClassRef).toEqual({ kind: 'learned', expenseClass: 'household' })
    expect(rule.expenseTypeRef).toEqual({ kind: 'unlearned' })
  })

  it('分類付きの手動登録でも学習ルールが作成される', async () => {
    const t = createTestApp()
    const categoryId = newUlid()
    const expenseTypeId = newUlid()
    const res = await request(t.app, 'POST', '/api/transactions', {
      body: {
        merchantName: 'コンビニB',
        amount: 800,
        occurredAt: '2026-07-05T03:00:00Z',
        classification: { categoryId, expenseClass: 'business_expense', expenseTypeId },
      },
    })
    expect(res.status).toBe(201)
    const rule = await t.deps.merchantLearningRuleRepository.findByMerchant(VIEWER_ID, 'コンビニB')
    expect(rule?.kind).toBe('active')
    if (rule?.kind !== 'active') return
    expect(rule.expenseTypeRef).toEqual({ kind: 'learned', expenseTypeId })
  })

  it('T-2: 既存ルールと値が変わった軸のみ LearningRuleUpdated が発行される', async () => {
    const t = createTestApp()
    const first = await createUnclassified(t)
    const categoryId = newUlid()
    await request(t.app, 'PUT', `/api/transactions/${first}/classify`, {
      body: { categoryId, expenseClass: 'household' },
    })
    const updates: LearningRuleUpdated[] = []
    t.deps.eventBus.subscribe<LearningRuleUpdated>('LearningRuleUpdated', e => {
      updates.push(e)
    })
    // 同一加盟店の別の未分類取引を、カテゴリは同一のまま費用区分だけ変えて確定する
    const second = await createUnclassified(t)
    await request(t.app, 'PUT', `/api/transactions/${second}/classify`, {
      body: { categoryId, expenseClass: 'personal_honey' },
    })
    expect(updates.map(e => e.axis)).toEqual(['expense_class'])
    const rule = await t.deps.merchantLearningRuleRepository.findByMerchant(VIEWER_ID, 'スーパーA')
    expect(rule?.kind === 'active' && rule.categoryRef).toEqual({ kind: 'learned', categoryId })
    expect(rule?.kind === 'active' && rule.expenseClassRef).toEqual({
      kind: 'learned',
      expenseClass: 'personal_honey',
    })
  })

  it('分類済み取引の再分類ではイベントを発行せず、学習ルールを上書きしない（L-4 選択は後続 Issue）', async () => {
    const t = createTestApp()
    const id = await createUnclassified(t)
    const categoryId = newUlid()
    await request(t.app, 'PUT', `/api/transactions/${id}/classify`, {
      body: { categoryId, expenseClass: 'household' },
    })
    const events: TransactionManuallyClassified[] = []
    t.deps.eventBus.subscribe<TransactionManuallyClassified>('TransactionManuallyClassified', e => {
      events.push(e)
    })
    const res = await request(t.app, 'PUT', `/api/transactions/${id}/classify`, {
      body: { categoryId: newUlid(), expenseClass: 'personal_honey' },
    })
    expect(res.status).toBe(200)
    expect(events).toHaveLength(0)
    const rule = await t.deps.merchantLearningRuleRepository.findByMerchant(VIEWER_ID, 'スーパーA')
    expect(rule?.kind === 'active' && rule.categoryRef).toEqual({ kind: 'learned', categoryId })
    expect(rule?.kind === 'active' && rule.expenseClassRef).toEqual({
      kind: 'learned',
      expenseClass: 'household',
    })
  })

  it('X-1: AMAZON.CO.JP の取引を分類しても学習ルールは作られない', async () => {
    const t = createTestApp()
    const createRes = await request(t.app, 'POST', '/api/transactions', {
      body: { merchantName: 'AMAZON.CO.JP', amount: 2500, occurredAt: '2026-07-05T03:00:00Z' },
    })
    const id = ((await createRes.json()) as { common: { transactionId: string } }).common
      .transactionId
    const res = await request(t.app, 'PUT', `/api/transactions/${id}/classify`, {
      body: { categoryId: newUlid(), expenseClass: 'household' },
    })
    expect(res.status).toBe(200)
    const rule = await t.deps.merchantLearningRuleRepository.findByMerchant(
      VIEWER_ID,
      'AMAZON.CO.JP',
    )
    expect(rule).toBeNull()
  })

  it('M-1: 学習無効化中の加盟店は学習されない', async () => {
    const t = createTestApp()
    await t.deps.merchantLearningRuleRepository.save({
      kind: 'disabled',
      common: { userId: VIEWER_ID, merchantName: 'スーパーA' },
      disabledAt: new Date(),
    })
    const id = await createUnclassified(t)
    const res = await request(t.app, 'PUT', `/api/transactions/${id}/classify`, {
      body: { categoryId: newUlid(), expenseClass: 'household' },
    })
    expect(res.status).toBe(200)
    const rule = await t.deps.merchantLearningRuleRepository.findByMerchant(VIEWER_ID, 'スーパーA')
    expect(rule?.kind).toBe('disabled')
  })

  it('F-1: 学習ルールは分類したユーザー本人にのみ作られる', async () => {
    const t = createTestApp()
    const id = await createUnclassified(t, SPOUSE_ID)
    const res = await request(t.app, 'PUT', `/api/transactions/${id}/classify`, {
      body: { categoryId: newUlid(), expenseClass: 'household' },
      viewerId: SPOUSE_ID,
    })
    expect(res.status).toBe(200)
    expect(
      (await t.deps.merchantLearningRuleRepository.findByMerchant(SPOUSE_ID, 'スーパーA'))?.kind,
    ).toBe('active')
    expect(
      await t.deps.merchantLearningRuleRepository.findByMerchant(VIEWER_ID, 'スーパーA'),
    ).toBeNull()
  })

  it('ハンドラー例外は隔離され、分類 API 自体は成功する', async () => {
    const t = createTestApp()
    const original = t.deps.merchantLearningRuleRepository
    t.deps.merchantLearningRuleRepository.save = async () => {
      throw new Error('injected learning save failure')
    }
    const id = await createUnclassified(t)
    const res = await request(t.app, 'PUT', `/api/transactions/${id}/classify`, {
      body: { categoryId: newUlid(), expenseClass: 'household' },
    })
    expect(res.status).toBe(200)
    expect(await original.findByMerchant(VIEWER_ID, 'スーパーA')).toBeNull()
  })

  it('TransactionManuallyClassified が発行される（購読者から観測可能）', async () => {
    const t = createTestApp()
    const events: TransactionManuallyClassified[] = []
    t.deps.eventBus.subscribe<TransactionManuallyClassified>('TransactionManuallyClassified', e => {
      events.push(e)
    })
    const id = await createUnclassified(t)
    const categoryId = newUlid()
    await request(t.app, 'PUT', `/api/transactions/${id}/classify`, {
      body: { categoryId, expenseClass: 'household' },
    })
    expect(events).toHaveLength(1)
    expect(events[0]?.transactionId).toBe(id)
    expect(events[0]?.userId).toBe(VIEWER_ID)
    expect(events[0]?.merchantName).toBe('スーパーA')
    expect(events[0]?.confirmedClassification).toEqual({ categoryId, expenseClass: 'household' })
  })
})
