/**
 * 許可リスト照合ガード（#533）
 *
 * 画面の役割判定は API を直接呼ばれると効かないため、許可リストに無い LINE ユーザーからの
 * 要求を入口で断つ。ここでは「断つこと」（否定形）と「世帯の 2 人は通ること」を両方固定する。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { AllowlistSchema, UserIdSchema, type AllowlistQuery } from '@warimaru/domain'
import { createTestApp, request, VIEWER_ID, SPOUSE_ID } from '../helpers/test-app.js'
import { traceIdOf } from '../../src/trace-id.js'
import { createCachingAllowlistQuery } from '../../src/caching-allowlist-query.js'

const STRANGER_ID = UserIdSchema.parse('user-stranger')
const DENIED_MESSAGE = 'このアプリは特定ユーザー専用です（許可リスト不一致）'

const NEW_ACCOUNT_BODY = {
  kind: 'other_savings',
  bankName: 'よその銀行',
  initialBalance: 1000,
} as const

/** 世帯外のユーザーがデータを作れてしまわないかを見るため、読みと書きの両方を試す */
const GUARDED_REQUESTS: readonly { method: string; path: string; body?: unknown }[] = [
  { method: 'GET', path: '/api/me' },
  { method: 'GET', path: '/api/dashboard?month=2026-08' },
  { method: 'GET', path: '/api/balances' },
  { method: 'POST', path: '/api/accounts', body: NEW_ACCOUNT_BODY },
]

async function errorOf(res: Response): Promise<string | undefined> {
  return ((await res.json()) as { error?: string }).error
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('許可リスト照合ガード', () => {
  it.each(GUARDED_REQUESTS)(
    '許可リストに無い利用者の $method $path を断る（否定形）',
    async ({ method, path, body }) => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const t = createTestApp()
      const res = await request(t.app, method, path, { viewerId: STRANGER_ID, body })
      expect(res.status).toBe(403)
      // 別要因の 403（ルート側の権限エラー等）とすり替わっていないことまで見る
      expect(await errorOf(res)).toBe(DENIED_MESSAGE)
    },
  )

  it('断った要求はルートに届かない（口座が作られていない）', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const t = createTestApp()
    await request(t.app, 'POST', '/api/accounts', {
      viewerId: STRANGER_ID,
      body: NEW_ACCOUNT_BODY,
    })
    expect(await t.deps.accountRepository.findByOwner(STRANGER_ID)).toHaveLength(0)
  })

  it.each([VIEWER_ID, SPOUSE_ID])('世帯の利用者 %s は通る', async viewerId => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/me', { viewerId })
    expect(res.status).toBe(200)
  })

  it('世帯の利用者を通した後でも、続けて来た世帯外の利用者は断る（否定形）', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const t = createTestApp()
    expect((await request(t.app, 'GET', '/api/me', { viewerId: VIEWER_ID })).status).toBe(200)
    expect((await request(t.app, 'GET', '/api/me', { viewerId: STRANGER_ID })).status).toBe(403)
  })

  it('世帯外の利用者を断った後でも、世帯の利用者は通る', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const t = createTestApp()
    expect((await request(t.app, 'GET', '/api/me', { viewerId: STRANGER_ID })).status).toBe(403)
    expect((await request(t.app, 'GET', '/api/me', { viewerId: VIEWER_ID })).status).toBe(200)
  })

  it('拒否のログは LINE userID そのものではなく、短縮識別子と要求先を残す', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const t = createTestApp()
    await request(t.app, 'GET', '/api/me', { viewerId: STRANGER_ID })
    const logged = warn.mock.calls.flat().join(' ')
    expect(logged).not.toContain(STRANGER_ID)
    expect(logged).toContain(traceIdOf(STRANGER_ID))
    expect(logged).toContain('path=/api/me')
  })

  it('認証されていない要求は許可リスト照合の前に 401 のまま', async () => {
    const t = createTestApp()
    const res = await t.app.request('/api/me')
    expect(res.status).toBe(401)
  })

  it('LIFF 認証の外にある経路（/health）は塞がない', async () => {
    const t = createTestApp()
    expect((await t.app.request('/health')).status).toBe(200)
  })
})

describe('許可リスト照合ガード — 素通しする登録要求', () => {
  it('未登録の世帯外の利用者の登録要求は、経路自身が断つ（拒否の記録も残る）', async () => {
    const t = createTestApp()
    const denied: unknown[] = []
    t.deps.eventBus.subscribe('AccessDenied', e => {
      denied.push(e)
    })
    const res = await request(t.app, 'POST', '/api/onboarding/register', {
      viewerId: STRANGER_ID,
      body: {},
    })
    expect(res.status).toBe(403)
    expect(await errorOf(res)).toBe(DENIED_MESSAGE)
    expect(denied).toHaveLength(1)
  })

  /**
   * #533 が塞ごうとしている状況そのもの。塞ぐ前に作られたアプリユーザー行が残っていても、
   * それが素通しの切符になってはいけない（許可リストから外れた旧メンバーも同じ）。
   */
  it('登録済みでも許可リストに無い利用者の登録要求は断る（否定形）', async () => {
    const t = createTestApp()
    // 許可リストに載っていた頃に作られた行を模す（許可リストには載っていない）
    await request(t.app, 'POST', '/api/onboarding/register', { viewerId: VIEWER_ID, body: {} })
    const narrowed: AllowlistQuery = {
      fetch: () =>
        Promise.resolve(
          AllowlistSchema.parse({ honeyLineUserId: SPOUSE_ID, darlingLineUserId: STRANGER_ID }),
        ),
    }
    const withNarrowedAllowlist = createTestApp({
      allowlistQuery: narrowed,
      appUserRepository: t.deps.appUserRepository,
    })
    const res = await request(withNarrowedAllowlist.app, 'POST', '/api/onboarding/register', {
      viewerId: VIEWER_ID,
      body: {},
    })
    expect(res.status).toBe(403)
    expect(await errorOf(res)).toBe(DENIED_MESSAGE)
  })
})

describe('許可リスト照合ガード — 許可リストを取得できないとき', () => {
  function failingAllowlistQuery(): AllowlistQuery {
    return { fetch: () => Promise.reject(new Error('Parameter Store が未構成')) }
  }

  it('取得できない要求は通さず 503 を返す（fail-closed）', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const t = createTestApp({ allowlistQuery: failingAllowlistQuery() })
    const res = await request(t.app, 'GET', '/api/me')
    expect(res.status).toBe(503)
  })

  it('取得できないときは書き込みも通さない（口座が作られていない）', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const t = createTestApp({ allowlistQuery: failingAllowlistQuery() })
    const res = await request(t.app, 'POST', '/api/accounts', { body: NEW_ACCOUNT_BODY })
    expect(res.status).toBe(503)
    expect(await t.deps.accountRepository.findByOwner(VIEWER_ID)).toHaveLength(0)
  })

  it('失敗の理由をログに残す（構成不備か一時障害かを見分けるため）', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const t = createTestApp({ allowlistQuery: failingAllowlistQuery() })
    await request(t.app, 'GET', '/api/me')
    expect(error.mock.calls.flat().join(' ')).toContain('Parameter Store が未構成')
  })

  it('取得の失敗は覚え込まず、次の要求で引き直す', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let shouldFail = true
    const t = createTestApp({
      allowlistQuery: {
        fetch: () =>
          shouldFail
            ? Promise.reject(new Error('一時的な取得失敗'))
            : Promise.resolve(
                AllowlistSchema.parse({
                  honeyLineUserId: VIEWER_ID,
                  darlingLineUserId: SPOUSE_ID,
                }),
              ),
      },
    })
    expect((await request(t.app, 'GET', '/api/me')).status).toBe(503)
    shouldFail = false
    expect((await request(t.app, 'GET', '/api/me')).status).toBe(200)
  })

  /**
   * 縮退運転そのものの規則（猶予時間の境界など）は createCachingAllowlistQuery 側の単体テストで
   * 固定済み。ここでは「ガードと組み合わせたときに実際に要求が通り続けるか」だけを見る（#650）。
   */
  it('猶予時間内なら、取得できなくなった後も世帯の利用者は通り続け、縮退運転に入ったことがログに残る（縮退運転、#650）', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let shouldFail = false
    let current = new Date('2026-08-24T00:00:00Z')
    const t = createTestApp({
      allowlistQuery: createCachingAllowlistQuery(
        {
          fetch: () =>
            shouldFail
              ? Promise.reject(new Error('Parameter Store が未構成'))
              : Promise.resolve(
                  AllowlistSchema.parse({
                    honeyLineUserId: VIEWER_ID,
                    darlingLineUserId: SPOUSE_ID,
                  }),
                ),
        },
        { ttlMs: 60_000, staleGraceMs: 30 * 60_000, now: () => current },
      ),
    })
    expect((await request(t.app, 'GET', '/api/me', { viewerId: VIEWER_ID })).status).toBe(200)

    shouldFail = true
    current = new Date('2026-08-24T00:20:00Z') // ttl 切れの後、猶予時間(30分)以内
    expect((await request(t.app, 'GET', '/api/me', { viewerId: VIEWER_ID })).status).toBe(200)
    // 通り続けていても、無言のまま縮退運転に入らない（#650 の信頼性レビュー指摘）
    const logged = error.mock.calls.flat().join(' ')
    expect(logged).toContain('Parameter Store が未構成')
    expect(logged).toContain('縮退運転')
  })

  it('猶予時間内でも、書き込み要求(口座作成)は実際に成功する（縮退運転、#650）', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let shouldFail = false
    let current = new Date('2026-08-24T00:00:00Z')
    const t = createTestApp({
      allowlistQuery: createCachingAllowlistQuery(
        {
          fetch: () =>
            shouldFail
              ? Promise.reject(new Error('Parameter Store が未構成'))
              : Promise.resolve(
                  AllowlistSchema.parse({
                    honeyLineUserId: VIEWER_ID,
                    darlingLineUserId: SPOUSE_ID,
                  }),
                ),
        },
        { ttlMs: 60_000, staleGraceMs: 30 * 60_000, now: () => current },
      ),
    })
    await request(t.app, 'GET', '/api/me', { viewerId: VIEWER_ID })

    shouldFail = true
    current = new Date('2026-08-24T00:20:00Z') // ttl 切れの後、猶予時間(30分)以内
    const res = await request(t.app, 'POST', '/api/accounts', {
      viewerId: VIEWER_ID,
      body: NEW_ACCOUNT_BODY,
    })
    expect(res.status).toBe(201)
    expect(await t.deps.accountRepository.findByOwner(VIEWER_ID)).toHaveLength(1)
  })

  it('猶予時間を過ぎると世帯の利用者も通らなくなる（否定形、#650）', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let shouldFail = false
    let current = new Date('2026-08-24T00:00:00Z')
    const t = createTestApp({
      allowlistQuery: createCachingAllowlistQuery(
        {
          fetch: () =>
            shouldFail
              ? Promise.reject(new Error('Parameter Store が未構成'))
              : Promise.resolve(
                  AllowlistSchema.parse({
                    honeyLineUserId: VIEWER_ID,
                    darlingLineUserId: SPOUSE_ID,
                  }),
                ),
        },
        { ttlMs: 60_000, staleGraceMs: 30 * 60_000, now: () => current },
      ),
    })
    await request(t.app, 'GET', '/api/me', { viewerId: VIEWER_ID })

    shouldFail = true
    current = new Date('2026-08-24T00:31:00Z') // 猶予時間(30分)を過ぎた
    expect((await request(t.app, 'GET', '/api/me', { viewerId: VIEWER_ID })).status).toBe(503)
  })
})
