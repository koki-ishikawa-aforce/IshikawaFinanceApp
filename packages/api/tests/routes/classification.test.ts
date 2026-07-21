import { describe, it, expect } from 'vitest'
import { TransactionIdSchema, TransactionSchema } from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-neon'
import type { TestApp } from '../helpers/test-app.js'
import { createTestApp, request, VIEWER_ID } from '../helpers/test-app.js'

async function seedUnclassified(t: TestApp): Promise<string> {
  const transactionId = TransactionIdSchema.parse(newUlid())
  await t.deps.transactionRepository.save(
    TransactionSchema.parse({
      kind: 'unclassified',
      common: {
        transactionId,
        ownerUserId: VIEWER_ID,
        merchantName: '未分類ストア',
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
})
