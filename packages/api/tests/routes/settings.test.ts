import { describe, it, expect } from 'vitest'
import type { TestApp } from '../helpers/test-app.js'
import { createTestApp, request, VIEWER_ID } from '../helpers/test-app.js'

interface ProfileResponse {
  profile: { userId: string; role: string; nickname: string | null }
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

async function register(t: TestApp, nickname?: string): Promise<Response> {
  return request(t.app, 'POST', '/api/onboarding/register', {
    body: nickname !== undefined ? { nickname } : {},
  })
}

describe('GET /api/settings/profile', () => {
  it('未登録でもロールを許可リストから解決して返す（nickname は null）', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/settings/profile')
    expect(res.status).toBe(200)
    const { profile } = await json<ProfileResponse>(res)
    expect(profile.userId).toBe(VIEWER_ID)
    expect(profile.role).toBe('honey')
    expect(profile.nickname).toBeNull()
  })

  it('登録後は AppUser のロールとニックネームを返す', async () => {
    const t = createTestApp()
    await register(t, 'はにー')
    const res = await request(t.app, 'GET', '/api/settings/profile')
    const { profile } = await json<ProfileResponse>(res)
    expect(profile.role).toBe('honey')
    expect(profile.nickname).toBe('はにー')
  })
})

describe('PUT /api/settings/nickname', () => {
  it('本人のニックネームを設定・解除できる', async () => {
    const t = createTestApp()
    await register(t)
    const set = await request(t.app, 'PUT', '/api/settings/nickname', {
      body: { nickname: 'はにー' },
    })
    expect(set.status).toBe(200)
    expect((await json<ProfileResponse>(set)).profile.nickname).toBe('はにー')

    const clear = await request(t.app, 'PUT', '/api/settings/nickname', {
      body: { nickname: null },
    })
    expect(clear.status).toBe(200)
    expect((await json<ProfileResponse>(clear)).profile.nickname).toBeNull()
  })

  it('未登録ユーザーは 404（オンボーディング未完了）', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'PUT', '/api/settings/nickname', {
      body: { nickname: 'はにー' },
    })
    expect(res.status).toBe(404)
  })

  it('11 文字以上は 400（Phase 3.5: ≤10 文字）', async () => {
    const t = createTestApp()
    await register(t)
    const res = await request(t.app, 'PUT', '/api/settings/nickname', {
      body: { nickname: 'あいうえおかきくけこさ' },
    })
    expect(res.status).toBe(400)
  })
})
