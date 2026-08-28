import { describe, it, expect } from 'vitest'
import { GmailOAuthTokenSchema, ParameterStorePathSchema } from '@warimaru/domain'
import type { UserId } from '@warimaru/domain'
import type { TestApp } from '../helpers/test-app.js'
import { createTestApp, request, VIEWER_ID, SPOUSE_ID } from '../helpers/test-app.js'

interface ProfileResponse {
  profile: { userId: string; role: string; nickname: string | null }
}

interface SpouseProfileResponse {
  profile: { nickname: string | null }
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
  it('相手が未登録なら nickname は null', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/settings/spouse-profile')
    expect(res.status).toBe(200)
    const { profile } = await json<SpouseProfileResponse>(res)
    expect(profile.nickname).toBeNull()
  })

  it('相手が登録済みなら、相手のニックネームを返す', async () => {
    const t = createTestApp()
    await request(t.app, 'POST', '/api/onboarding/register', {
      body: { nickname: 'だーりん' },
      viewerId: SPOUSE_ID,
    })
    const res = await request(t.app, 'GET', '/api/settings/spouse-profile')
    const { profile } = await json<SpouseProfileResponse>(res)
    expect(profile.nickname).toBe('だーりん')
  })

  it('相手から見た自分（VIEWER_ID）のニックネームも同様に返る（対称性）', async () => {
    const t = createTestApp()
    await register(t, 'はにー')
    const res = await request(t.app, 'GET', '/api/settings/spouse-profile', {
      viewerId: SPOUSE_ID,
    })
    const { profile } = await json<SpouseProfileResponse>(res)
    expect(profile.nickname).toBe('はにー')
  })

  it('相手の userId など、ニックネーム以外の情報は返さない（相手の識別情報を漏らさない）', async () => {
    const t = createTestApp()
    await request(t.app, 'POST', '/api/onboarding/register', {
      body: { nickname: 'だーりん' },
      viewerId: SPOUSE_ID,
    })
    const res = await request(t.app, 'GET', '/api/settings/spouse-profile')
    const { profile } = await json<{ profile: Record<string, unknown> }>(res)
    expect(Object.keys(profile)).toEqual(['nickname'])
  })
})

describe('GET /api/settings/gmail-link', () => {
  async function saveToken(t: TestApp, userId: UserId, revoked: boolean): Promise<void> {
    await t.deps.gmailOAuthTokenRepository.save(
      GmailOAuthTokenSchema.parse(
        revoked
          ? {
              kind: 'revocation_detected',
              userId,
              tokenStoreRef: ParameterStorePathSchema.parse(`/warimaru/gmail/${userId}`),
              authorizedAt: new Date('2026-05-01T09:00:00Z'),
              revocationDetectedAt: new Date('2026-07-10T21:00:00Z'),
              revocationReason: 'api_call_failure',
            }
          : {
              kind: 'valid',
              userId,
              tokenStoreRef: ParameterStorePathSchema.parse(`/warimaru/gmail/${userId}`),
              authorizedAt: new Date('2026-05-01T09:00:00Z'),
              lastVerifiedAt: new Date('2026-05-01T09:00:00Z'),
            },
      ),
    )
  }

  it('未連携なら not_linked を返す', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/settings/gmail-link')
    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ gmailLink: { kind: 'not_linked' } })
  })

  it('連携中なら valid と認可日時を返す', async () => {
    const t = createTestApp()
    await saveToken(t, VIEWER_ID, false)
    const res = await request(t.app, 'GET', '/api/settings/gmail-link')
    expect(await json(res)).toEqual({
      gmailLink: { kind: 'valid', authorizedAt: '2026-05-01T09:00:00.000Z' },
    })
  })

  it('失効検知済みなら revocation_detected と検知日時を返す', async () => {
    const t = createTestApp()
    await saveToken(t, VIEWER_ID, true)
    const res = await request(t.app, 'GET', '/api/settings/gmail-link')
    expect(await json(res)).toEqual({
      gmailLink: {
        kind: 'revocation_detected',
        revocationDetectedAt: '2026-07-10T21:00:00.000Z',
      },
    })
  })

  it('トークンの保管参照（Parameter Store パス）は応答に含めない', async () => {
    const t = createTestApp()
    await saveToken(t, VIEWER_ID, false)
    const res = await request(t.app, 'GET', '/api/settings/gmail-link')
    const body = await json<{ gmailLink: Record<string, unknown> }>(res)
    expect(Object.keys(body.gmailLink).sort()).toEqual(['authorizedAt', 'kind'])
  })

  it('返るのは閲覧者本人の状態のみ（相手の失効は自分の応答に現れない）', async () => {
    const t = createTestApp()
    await saveToken(t, VIEWER_ID, false)
    await saveToken(t, SPOUSE_ID, true)
    const viewer = await request(t.app, 'GET', '/api/settings/gmail-link')
    expect(await json(viewer)).toEqual({
      gmailLink: { kind: 'valid', authorizedAt: '2026-05-01T09:00:00.000Z' },
    })
    const spouse = await request(t.app, 'GET', '/api/settings/gmail-link', {
      viewerId: SPOUSE_ID,
    })
    expect(await json<{ gmailLink: { kind: string } }>(spouse)).toMatchObject({
      gmailLink: { kind: 'revocation_detected' },
    })
  })
})
