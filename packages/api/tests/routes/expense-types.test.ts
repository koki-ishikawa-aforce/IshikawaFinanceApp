import { describe, it, expect } from 'vitest'
import { ExpenseTypeMasterSchema } from '@warimaru/domain'
import type { UserId } from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-neon'
import type { TestApp } from '../helpers/test-app.js'
import { createTestApp, request, SPOUSE_ID, VIEWER_ID } from '../helpers/test-app.js'

async function createExpenseType(t: TestApp, name: string, viewerId?: UserId): Promise<string> {
  const res = await request(t.app, 'POST', '/api/expense-types', { body: { name }, viewerId })
  expect(res.status).toBe(201)
  return ((await res.json()) as { expenseTypeId: string }).expenseTypeId
}

async function seedDefaultExpenseType(t: TestApp): Promise<string> {
  const def = ExpenseTypeMasterSchema.parse({
    kind: 'default',
    expenseTypeId: newUlid(),
    name: 'ジム',
    scope: { kind: 'household_shared' },
    defaultKind: 'gym',
  })
  await t.deps.expenseTypeMasterRepository.save(def)
  return def.expenseTypeId
}

describe('GET /api/expense-types', () => {
  it('世帯共有と本人の個人別のみ返す（他ユーザーの個人別は見えない）', async () => {
    const t = createTestApp()
    const sharedId = await seedDefaultExpenseType(t)
    const ownId = await createExpenseType(t, 'セミナー')
    await createExpenseType(t, 'ゴルフ用品', SPOUSE_ID)

    const res = await request(t.app, 'GET', '/api/expense-types')
    expect(res.status).toBe(200)
    const items = ((await res.json()) as { items: { expenseTypeId: string }[] }).items
    expect(items.map(i => i.expenseTypeId).sort()).toEqual([sharedId, ownId].sort())
  })
})

describe('POST /api/expense-types', () => {
  it('本人の個人別追加経費種別として作成される', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'POST', '/api/expense-types', { body: { name: 'セミナー' } })
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      kind: string
      name: string
      scope: { kind: string; userId: string }
      createdByUserId: string
    }
    expect(body.kind).toBe('custom')
    expect(body.name).toBe('セミナー')
    expect(body.scope).toEqual({ kind: 'personal', userId: VIEWER_ID })
    expect(body.createdByUserId).toBe(VIEWER_ID)
  })

  it('name が空文字は 400', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'POST', '/api/expense-types', { body: { name: '' } })
    expect(res.status).toBe(400)
  })
})

describe('PUT /api/expense-types/:id', () => {
  it('本人の追加経費種別を改名でき、改名履歴が残る', async () => {
    const t = createTestApp()
    const id = await createExpenseType(t, 'セミナー')
    const res = await request(t.app, 'PUT', `/api/expense-types/${id}`, {
      body: { name: '研修' },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { name: string; renameHistory: unknown[] }
    expect(body.name).toBe('研修')
    expect(body.renameHistory).toHaveLength(1)
  })

  it('規定経費種別の改名は 409', async () => {
    const t = createTestApp()
    const id = await seedDefaultExpenseType(t)
    const res = await request(t.app, 'PUT', `/api/expense-types/${id}`, {
      body: { name: 'フィットネス' },
    })
    expect(res.status).toBe(409)
  })

  it('他ユーザーの追加経費種別の改名は 403', async () => {
    const t = createTestApp()
    const id = await createExpenseType(t, 'ゴルフ用品', SPOUSE_ID)
    const res = await request(t.app, 'PUT', `/api/expense-types/${id}`, {
      body: { name: 'テニス用品' },
    })
    expect(res.status).toBe(403)
  })

  it('存在しない経費種別は 404', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'PUT', `/api/expense-types/${newUlid()}`, {
      body: { name: '研修' },
    })
    expect(res.status).toBe(404)
  })
})
