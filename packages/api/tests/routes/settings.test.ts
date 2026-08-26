import { describe, it, expect } from 'vitest'
import type { TestApp } from '../helpers/test-app.js'
import { createTestApp, request, VIEWER_ID, SPOUSE_ID } from '../helpers/test-app.js'

interface ProfileResponse {
  profile: { userId: string; role: string; nickname: string | null }
}

interface SpouseProfileResponse {
  profile: { role: string; nickname: string | null }
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

  it('不正な JSON ボディは 400（500 に落ちない、#565）', async () => {
    const t = createTestApp()
    await register(t)
    const res = await t.app.request('/api/settings/nickname', {
      method: 'PUT',
      headers: { 'X-User-Id': VIEWER_ID, 'Content-Type': 'application/json' },
      body: '{ not json',
    })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/settings/spouse-profile', () => {
  it('相手が未登録なら、許可リストから役割だけ解決し nickname は null', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/settings/spouse-profile')
    expect(res.status).toBe(200)
    const { profile } = await json<SpouseProfileResponse>(res)
    expect(profile.role).toBe('darling')
    expect(profile.nickname).toBeNull()
  })

  it('相手が登録済みなら、相手のロールとニックネームを返す', async () => {
    const t = createTestApp()
    await request(t.app, 'POST', '/api/onboarding/register', {
      body: { nickname: 'だーりん' },
      viewerId: SPOUSE_ID,
    })
    const res = await request(t.app, 'GET', '/api/settings/spouse-profile')
    const { profile } = await json<SpouseProfileResponse>(res)
    expect(profile.role).toBe('darling')
    expect(profile.nickname).toBe('だーりん')
  })

  it('相手から見た自分（VIEWER_ID）は honey として解決される', async () => {
    const t = createTestApp()
    await register(t, 'はにー')
    const res = await request(t.app, 'GET', '/api/settings/spouse-profile', {
      viewerId: SPOUSE_ID,
    })
    const { profile } = await json<SpouseProfileResponse>(res)
    expect(profile.role).toBe('honey')
    expect(profile.nickname).toBe('はにー')
  })
})
