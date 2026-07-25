import { describe, it, expect } from 'vitest'
import {
  CategoryDeletionRemapRequestedSchema,
  CategoryMasterSchema,
  MerchantLearningRuleSchema,
  AmazonProductKeyLearningRuleSchema,
  TransactionIdSchema,
  TransactionSchema,
  YearMonthSchema,
} from '@warimaru/domain'
import type { CategoryDeletionRequestId, UserId } from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-neon'
import type { TestApp } from '../helpers/test-app.js'
import { createTestApp, request, SPOUSE_ID, VIEWER_ID } from '../helpers/test-app.js'

async function createCategory(t: TestApp, name: string, viewerId?: UserId): Promise<string> {
  const res = await request(t.app, 'POST', '/api/categories', { body: { name }, viewerId })
  expect(res.status).toBe(201)
  return ((await res.json()) as { categoryId: string }).categoryId
}

async function createExpenseType(t: TestApp, name: string, viewerId?: UserId): Promise<string> {
  const res = await request(t.app, 'POST', '/api/expense-types', { body: { name }, viewerId })
  expect(res.status).toBe(201)
  return ((await res.json()) as { expenseTypeId: string }).expenseTypeId
}

async function seedClassifiedTransaction(
  t: TestApp,
  input: { categoryId?: string; expenseTypeId?: string },
): Promise<string> {
  const transactionId = TransactionIdSchema.parse(newUlid())
  await t.deps.transactionRepository.save(
    TransactionSchema.parse({
      kind: 'classified',
      common: {
        transactionId,
        ownerUserId: VIEWER_ID,
        merchantName: 'スーパーA',
        amount: 1200,
        occurredAt: new Date('2026-07-05T03:00:00Z'),
        importSource: {
          kind: 'manual',
          enteredAt: new Date('2026-07-05T04:00:00Z'),
          enteredByUserId: VIEWER_ID,
        },
      },
      details: {
        categoryId: input.categoryId ?? newUlid(),
        expenseClass: input.expenseTypeId !== undefined ? 'business_expense' : 'household',
        expenseTypeRef:
          input.expenseTypeId !== undefined
            ? { kind: 'business', expenseTypeId: input.expenseTypeId }
            : { kind: 'non_business' },
        basis: {
          kind: 'user_manual',
          modifiedByUserId: VIEWER_ID,
          modifiedAt: new Date('2026-07-05T05:00:00Z'),
        },
      },
    }),
  )
  return transactionId
}

describe('POST /api/categories/:id/deletion-requests', () => {
  it('取引・学習ルールをリマップし、マスタを物理削除して remap_completed を返す', async () => {
    const t = createTestApp()
    const target = await createCategory(t, '推し活')
    const destination = await createCategory(t, '娯楽費')
    const transactionId = await seedClassifiedTransaction(t, { categoryId: target })
    await t.deps.merchantLearningRuleRepository.save(
      MerchantLearningRuleSchema.parse({
        kind: 'active',
        common: { userId: VIEWER_ID, merchantName: 'スーパーA' },
        categoryRef: { kind: 'learned', categoryId: target },
        expenseClassRef: { kind: 'learned', expenseClass: 'household' },
        expenseTypeRef: { kind: 'unlearned' },
        lastUpdatedAt: new Date('2026-07-01T00:00:00Z'),
      }),
    )
    await t.deps.amazonProductKeyLearningRuleRepository.save(
      AmazonProductKeyLearningRuleSchema.parse({
        userId: VIEWER_ID,
        amazonProductKey: '本',
        categoryRef: { kind: 'learned', categoryId: target },
        expenseClassRef: { kind: 'unlearned' },
        expenseTypeRef: { kind: 'unlearned' },
        lastUpdatedAt: new Date('2026-07-01T00:00:00Z'),
      }),
    )

    const res = await request(t.app, 'POST', `/api/categories/${target}/deletion-requests`, {
      body: { destinationCategoryId: destination, destinationExpenseClass: 'household' },
    })
    expect(res.status).toBe(201)
    const { request: deletionRequest } = (await res.json()) as {
      request: {
        state: { kind: string; affectedTransactionCount: number; affectedLearningRuleCount: number }
      }
    }
    expect(deletionRequest.state.kind).toBe('remap_completed')
    expect(deletionRequest.state.affectedTransactionCount).toBe(1)
    expect(deletionRequest.state.affectedLearningRuleCount).toBe(2)

    // マスタは物理削除済み
    expect(await t.deps.categoryMasterRepository.findById(target as never)).toBeNull()
    // 取引は移動先カテゴリへ付け替え済み
    const remapped = await t.deps.transactionRepository.findById(
      TransactionIdSchema.parse(transactionId),
    )
    if (remapped?.kind !== 'classified') throw new Error('classified を期待')
    expect(remapped.details.categoryId).toBe(destination)
    // 学習ルールもカテゴリ軸のみリマップ済み
    const rules = await t.deps.merchantLearningRuleRepository.findAllByUser(VIEWER_ID)
    const rule = rules[0]
    if (rule?.kind !== 'active') throw new Error('active を期待')
    expect(rule.categoryRef).toEqual({ kind: 'learned', categoryId: destination })
    expect(rule.expenseClassRef).toEqual({ kind: 'learned', expenseClass: 'household' })
  })

  it('business_expense 移動で destinationExpenseTypeId がなければ 400', async () => {
    const t = createTestApp()
    const target = await createCategory(t, '推し活')
    const destination = await createCategory(t, '娯楽費')
    const res = await request(t.app, 'POST', `/api/categories/${target}/deletion-requests`, {
      body: { destinationCategoryId: destination, destinationExpenseClass: 'business_expense' },
    })
    expect(res.status).toBe(400)
  })

  it('移動先に削除対象自身は 409', async () => {
    const t = createTestApp()
    const target = await createCategory(t, '推し活')
    const res = await request(t.app, 'POST', `/api/categories/${target}/deletion-requests`, {
      body: { destinationCategoryId: target, destinationExpenseClass: 'household' },
    })
    expect(res.status).toBe(409)
  })

  it('規定カテゴリの削除リクエストは 409', async () => {
    const t = createTestApp()
    const def = CategoryMasterSchema.parse({
      kind: 'default',
      categoryId: newUlid(),
      name: '食費',
      scope: { kind: 'household_shared' },
      defaultKind: 'food',
    })
    await t.deps.categoryMasterRepository.save(def)
    const destination = await createCategory(t, '娯楽費')
    const res = await request(
      t.app,
      'POST',
      `/api/categories/${def.categoryId}/deletion-requests`,
      { body: { destinationCategoryId: destination, destinationExpenseClass: 'household' } },
    )
    expect(res.status).toBe(409)
  })

  it('他ユーザーのカテゴリの削除リクエストは 403', async () => {
    const t = createTestApp()
    const spouses = await createCategory(t, 'ゴルフ', SPOUSE_ID)
    const destination = await createCategory(t, '娯楽費')
    const res = await request(t.app, 'POST', `/api/categories/${spouses}/deletion-requests`, {
      body: { destinationCategoryId: destination, destinationExpenseClass: 'household' },
    })
    expect(res.status).toBe(403)
  })

  it('DELETE /api/categories/:id は 409 で新フローを案内する', async () => {
    const t = createTestApp()
    const target = await createCategory(t, '推し活')
    const res = await request(t.app, 'DELETE', `/api/categories/${target}`)
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('deletion-requests')
  })
})

describe('POST /api/expense-types/:id/deletion-requests', () => {
  it('取引の経費種別を付け替え、月次上限を削除し、マスタを物理削除する', async () => {
    const t = createTestApp()
    const target = await createExpenseType(t, 'セミナー')
    const destination = await createExpenseType(t, '書籍')
    const transactionId = await seedClassifiedTransaction(t, { expenseTypeId: target })
    const limitRes = await request(t.app, 'PUT', '/api/monthly-limits', {
      body: { expenseTypeId: target, capAmount: 10000 },
    })
    expect(limitRes.status).toBe(200)

    const res = await request(t.app, 'POST', `/api/expense-types/${target}/deletion-requests`, {
      body: { destinationExpenseTypeId: destination },
    })
    expect(res.status).toBe(201)
    const { request: deletionRequest } = (await res.json()) as {
      request: { state: { kind: string; affectedTransactionCount: number } }
    }
    expect(deletionRequest.state.kind).toBe('remap_completed')
    expect(deletionRequest.state.affectedTransactionCount).toBe(1)

    expect(await t.deps.expenseTypeMasterRepository.findById(target as never)).toBeNull()
    const remapped = await t.deps.transactionRepository.findById(
      TransactionIdSchema.parse(transactionId),
    )
    if (remapped?.kind !== 'classified') throw new Error('classified を期待')
    expect(remapped.details.expenseClass).toBe('business_expense')
    expect(remapped.details.expenseTypeRef).toEqual({
      kind: 'business',
      expenseTypeId: destination,
    })
    // 削除対象の月次上限は物理削除済み
    expect(
      await t.deps.monthlyLimitRepository.findByUserAndExpenseType(VIEWER_ID, target as never),
    ).toBeNull()
  })

  it('他ユーザーの経費種別を移動先には 403', async () => {
    const t = createTestApp()
    const target = await createExpenseType(t, 'セミナー')
    const spouses = await createExpenseType(t, 'ゴルフ用品', SPOUSE_ID)
    const res = await request(t.app, 'POST', `/api/expense-types/${target}/deletion-requests`, {
      body: { destinationExpenseTypeId: spouses },
    })
    expect(res.status).toBe(403)
  })

  it('DELETE /api/expense-types/:id は 409 で新フローを案内する', async () => {
    const t = createTestApp()
    const target = await createExpenseType(t, 'セミナー')
    const res = await request(t.app, 'DELETE', `/api/expense-types/${target}`)
    expect(res.status).toBe(409)
  })
})

describe('カテゴリ削除リマップの月次表示整合', () => {
  it('リマップ後の取引は移動先カテゴリで月次照会できる', async () => {
    const t = createTestApp()
    const target = await createCategory(t, '推し活')
    const destination = await createCategory(t, '娯楽費')
    await seedClassifiedTransaction(t, { categoryId: target })
    await request(t.app, 'POST', `/api/categories/${target}/deletion-requests`, {
      body: { destinationCategoryId: destination, destinationExpenseClass: 'household' },
    })
    const transactions = await t.deps.transactionRepository.findByMonth(
      VIEWER_ID,
      YearMonthSchema.parse('2026-07'),
    )
    expect(transactions).toHaveLength(1)
    const tx = transactions[0]
    if (tx?.kind !== 'classified') throw new Error('classified を期待')
    expect(tx.details.categoryId).toBe(destination)
  })
})

describe('マスタ削除リマップの冪等性・失敗時のマスタ保全（#223）', () => {
  it('リマップ要請イベントの再配信で二重付け替えせず、マスタは削除済みのまま', async () => {
    const t = createTestApp()
    const target = await createCategory(t, '推し活')
    const destination = await createCategory(t, '娯楽費')
    const transactionId = await seedClassifiedTransaction(t, { categoryId: target })
    await t.deps.merchantLearningRuleRepository.save(
      MerchantLearningRuleSchema.parse({
        kind: 'active',
        common: { userId: VIEWER_ID, merchantName: 'スーパーA' },
        categoryRef: { kind: 'learned', categoryId: target },
        expenseClassRef: { kind: 'learned', expenseClass: 'household' },
        expenseTypeRef: { kind: 'unlearned' },
        lastUpdatedAt: new Date('2026-07-01T00:00:00Z'),
      }),
    )

    const res = await request(t.app, 'POST', `/api/categories/${target}/deletion-requests`, {
      body: { destinationCategoryId: destination, destinationExpenseClass: 'household' },
    })
    expect(res.status).toBe(201)
    const { request: deletionRequest } = (await res.json()) as {
      request: {
        categoryDeletionRequestId: string
        state: { kind: string; affectedTransactionCount: number; affectedLearningRuleCount: number }
      }
    }
    expect(deletionRequest.state.kind).toBe('remap_completed')

    // 同一のリマップ要請イベントを再配信（at-least-once の二重配信を模擬）
    await t.deps.eventBus.publish(
      CategoryDeletionRemapRequestedSchema.parse({
        eventId: newUlid(),
        occurredAt: new Date(),
        type: 'CategoryDeletionRemapRequested',
        categoryDeletionRequestId: deletionRequest.categoryDeletionRequestId,
        targetCategoryId: target,
        destinationCategoryId: destination,
        destinationExpenseClass: 'household',
      }),
    )

    // マスタは削除済みのまま、状態と件数は不変（二重付け替えしない）
    expect(await t.deps.categoryMasterRepository.findById(target as never)).toBeNull()
    const reread = await t.deps.categoryDeletionRequestRepository.findById(
      deletionRequest.categoryDeletionRequestId as CategoryDeletionRequestId,
    )
    expect(reread?.state.kind).toBe('remap_completed')
    if (reread?.state.kind === 'remap_completed') {
      expect(reread.state.affectedTransactionCount).toBe(1)
      expect(reread.state.affectedLearningRuleCount).toBe(1)
    }
    const remapped = await t.deps.transactionRepository.findById(
      TransactionIdSchema.parse(transactionId),
    )
    if (remapped?.kind !== 'classified') throw new Error('classified を期待')
    expect(remapped.details.categoryId).toBe(destination)
  })

  it('いずれかのコンテキストの付け替えが失敗するとマスタは物理削除されず remap_failed になる', async () => {
    const t = createTestApp()
    const target = await createCategory(t, '推し活')
    const destination = await createCategory(t, '娯楽費')
    await seedClassifiedTransaction(t, { categoryId: target })

    // 自動分類・学習コンテキストの付け替えを失敗させる（学習ルールストア障害を模擬）
    t.deps.merchantLearningRuleRepository.findAllByUser = async () => {
      throw new Error('learning rule store unavailable')
    }
    // 保存された削除リクエストID を捕捉する（失敗時は POST レスポンスから取得できないため）
    let capturedId: string | undefined
    const originalSave = t.deps.categoryDeletionRequestRepository.save.bind(
      t.deps.categoryDeletionRequestRepository,
    )
    t.deps.categoryDeletionRequestRepository.save = async deletionRequest => {
      capturedId = deletionRequest.categoryDeletionRequestId
      return originalSave(deletionRequest)
    }

    const res = await request(t.app, 'POST', `/api/categories/${target}/deletion-requests`, {
      body: { destinationCategoryId: destination, destinationExpenseClass: 'household' },
    })
    expect(res.status).toBe(500)

    // マスタは残る（1コンテキストでも失敗したら物理削除しない）
    expect(await t.deps.categoryMasterRepository.findById(target as never)).not.toBeNull()
    if (capturedId === undefined) throw new Error('削除リクエストID を捕捉できなかった')
    const reread = await t.deps.categoryDeletionRequestRepository.findById(
      capturedId as CategoryDeletionRequestId,
    )
    expect(reread?.state.kind).toBe('remap_failed')
  })
})
