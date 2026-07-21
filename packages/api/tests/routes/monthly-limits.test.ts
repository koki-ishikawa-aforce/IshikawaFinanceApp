import { describe, it, expect } from 'vitest'
import { MonthlyLimitIdSchema, MonthlyLimitSchema } from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-neon'
import type { TestApp } from '../helpers/test-app.js'
import { createTestApp, request, SPOUSE_ID, VIEWER_ID } from '../helpers/test-app.js'

async function createExpenseType(t: TestApp, name: string, viewerId = VIEWER_ID): Promise<string> {
  const res = await request(t.app, 'POST', '/api/expense-types', { body: { name }, viewerId })
  expect(res.status).toBe(201)
  return ((await res.json()) as { expenseTypeId: string }).expenseTypeId
}

describe('PUT /api/monthly-limits', () => {
  it('本人の経費種別に上限を設定できる', async () => {
    const t = createTestApp()
    const expenseTypeId = await createExpenseType(t, 'セミナー')
    const res = await request(t.app, 'PUT', '/api/monthly-limits', {
      body: { expenseTypeId, capAmount: 10000 },
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { kind: string }).kind).toBe('capped')
  })

  it('他ユーザーの個人別経費種別への上限設定は 403', async () => {
    const t = createTestApp()
    const spouses = await createExpenseType(t, 'ゴルフ用品', SPOUSE_ID)
    const res = await request(t.app, 'PUT', '/api/monthly-limits', {
      body: { expenseTypeId: spouses, capAmount: 10000 },
    })
    expect(res.status).toBe(403)
  })
})

describe('GET /api/monthly-limits?month=', () => {
  it('過去月は changeHistory から当時の上限を復元する', async () => {
    const t = createTestApp()
    const expenseTypeId = await createExpenseType(t, 'セミナー')
    // 5 月から 10000 で開始し、7/10 に 20000 へ変更した上限
    await t.deps.monthlyLimitRepository.save(
      MonthlyLimitSchema.parse({
        kind: 'capped',
        monthlyLimitId: MonthlyLimitIdSchema.parse(newUlid()),
        userId: VIEWER_ID,
        expenseTypeId,
        effectiveFrom: new Date('2026-05-01T00:00:00Z'),
        capAmount: 20000,
        changeHistory: [
          {
            oldCapAmount: 10000,
            newCapAmount: 20000,
            changedAt: new Date('2026-07-10T00:00:00Z'),
            changedByUserId: VIEWER_ID,
          },
        ],
      }),
    )

    const june = await request(t.app, 'GET', '/api/monthly-limits?month=2026-06')
    const juneItems = (
      (await june.json()) as { items: { capAmount: number; changeHistory: unknown[] }[] }
    ).items
    expect(juneItems).toHaveLength(1)
    expect(juneItems[0]?.capAmount).toBe(10000)
    expect(juneItems[0]?.changeHistory).toHaveLength(0)

    const july = await request(t.app, 'GET', '/api/monthly-limits?month=2026-07')
    const julyItems = ((await july.json()) as { items: { capAmount: number }[] }).items
    expect(julyItems[0]?.capAmount).toBe(20000)
  })

  it('適用開始前の月には上限が現れない', async () => {
    const t = createTestApp()
    const expenseTypeId = await createExpenseType(t, 'セミナー')
    await t.deps.monthlyLimitRepository.save(
      MonthlyLimitSchema.parse({
        kind: 'capped',
        monthlyLimitId: MonthlyLimitIdSchema.parse(newUlid()),
        userId: VIEWER_ID,
        expenseTypeId,
        effectiveFrom: new Date('2026-07-01T00:00:00Z'),
        capAmount: 10000,
        changeHistory: [],
      }),
    )
    const res = await request(t.app, 'GET', '/api/monthly-limits?month=2026-06')
    expect(((await res.json()) as { items: unknown[] }).items).toHaveLength(0)
  })

  it('unlimited はそのまま返る（履歴を持たないため復元対象外）', async () => {
    const t = createTestApp()
    const expenseTypeId = await createExpenseType(t, 'セミナー')
    await t.deps.monthlyLimitRepository.save(
      MonthlyLimitSchema.parse({
        kind: 'unlimited',
        monthlyLimitId: MonthlyLimitIdSchema.parse(newUlid()),
        userId: VIEWER_ID,
        expenseTypeId,
        effectiveFrom: new Date('2026-05-01T00:00:00Z'),
      }),
    )
    const res = await request(t.app, 'GET', '/api/monthly-limits?month=2026-06')
    const items = ((await res.json()) as { items: { kind: string }[] }).items
    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe('unlimited')
  })
})
