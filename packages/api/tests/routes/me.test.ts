import { describe, it, expect, vi, afterEach } from 'vitest'
import { createTestApp, request, SPOUSE_ID, VIEWER_ID } from '../helpers/test-app.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GET /api/me', () => {
  it('viewerId とロールを返す', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/me')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ viewerId: VIEWER_ID, role: 'darling' })
  })

  it('X-User-Id ヘッダーのユーザーが viewer になる', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/me', { viewerId: SPOUSE_ID })
    expect(((await res.json()) as { viewerId: string }).viewerId).toBe(SPOUSE_ID)
  })

  it('X-User-Id なし（DEFAULT_USER_ID フォールバックもなし）は 401', async () => {
    vi.stubEnv('DEFAULT_USER_ID', '')
    const t = createTestApp()
    const res = await t.app.request('/api/me')
    expect(res.status).toBe(401)
  })
})
