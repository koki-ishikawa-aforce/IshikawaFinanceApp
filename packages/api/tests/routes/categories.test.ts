import { describe, it, expect } from 'vitest'
import { CategoryMasterSchema } from '@warimaru/domain'
import type { UserId } from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-neon'
import type { TestApp } from '../helpers/test-app.js'
import { createTestApp, request, SPOUSE_ID, VIEWER_ID } from '../helpers/test-app.js'

async function createCategory(t: TestApp, name: string, viewerId?: UserId): Promise<string> {
  const res = await request(t.app, 'POST', '/api/categories', { body: { name }, viewerId })
  expect(res.status).toBe(201)
  return ((await res.json()) as { categoryId: string }).categoryId
}

async function seedDefaultCategory(t: TestApp): Promise<string> {
  const def = CategoryMasterSchema.parse({
    kind: 'default',
    categoryId: newUlid(),
    name: '食費',
    scope: { kind: 'household_shared' },
    defaultKind: 'food',
  })
  await t.deps.categoryMasterRepository.save(def)
  return def.categoryId
}

describe('GET /api/categories', () => {
  it('世帯共有と本人の個人別のみ返す（他ユーザーの個人別は見えない）', async () => {
    const t = createTestApp()
    const sharedId = await seedDefaultCategory(t)
    const ownId = await createCategory(t, '推し活')
    await createCategory(t, 'ゴルフ', SPOUSE_ID)

    const res = await request(t.app, 'GET', '/api/categories')
    expect(res.status).toBe(200)
    const items = ((await res.json()) as { items: { categoryId: string }[] }).items
    expect(items.map(i => i.categoryId).sort()).toEqual([sharedId, ownId].sort())
  })
})

describe('POST /api/categories', () => {
  it('本人の個人別追加カテゴリとして作成される', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'POST', '/api/categories', { body: { name: '推し活' } })
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      kind: string
      name: string
      scope: { kind: string; userId: string }
      createdByUserId: string
    }
    expect(body.kind).toBe('custom')
    expect(body.name).toBe('推し活')
    expect(body.scope).toEqual({ kind: 'personal', userId: VIEWER_ID })
    expect(body.createdByUserId).toBe(VIEWER_ID)
  })

  it('name が空文字は 400', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'POST', '/api/categories', { body: { name: '' } })
    expect(res.status).toBe(400)
  })
})

describe('PUT /api/categories/:id', () => {
  it('本人の追加カテゴリを改名でき、改名履歴が残る', async () => {
    const t = createTestApp()
    const id = await createCategory(t, '推し活')
    const res = await request(t.app, 'PUT', `/api/categories/${id}`, {
      body: { name: 'エンタメ' },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { name: string; renameHistory: unknown[] }
    expect(body.name).toBe('エンタメ')
    expect(body.renameHistory).toHaveLength(1)
  })

  it('規定カテゴリの改名は 409', async () => {
    const t = createTestApp()
    const id = await seedDefaultCategory(t)
    const res = await request(t.app, 'PUT', `/api/categories/${id}`, {
      body: { name: 'ごはん' },
    })
    expect(res.status).toBe(409)
  })

  it('他ユーザーの追加カテゴリの改名は 403', async () => {
    const t = createTestApp()
    const id = await createCategory(t, 'ゴルフ', SPOUSE_ID)
    const res = await request(t.app, 'PUT', `/api/categories/${id}`, {
      body: { name: 'テニス' },
    })
    expect(res.status).toBe(403)
  })

  it('存在しないカテゴリは 404', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'PUT', `/api/categories/${newUlid()}`, {
      body: { name: 'エンタメ' },
    })
    expect(res.status).toBe(404)
  })
})
