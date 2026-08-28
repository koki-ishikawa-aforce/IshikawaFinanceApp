/**
 * GET /health（#650）
 *
 * 本体プロセスの生存(ok)とは別に、許可リストの取得状況を外形監視が読み取れるようにする。
 * 縮退開始時刻・理由(health().detail)は認証不要のこの経路では公開しない（情報開示対策）。
 */
import { describe, it, expect } from 'vitest'
import { createTestApp } from '../helpers/test-app.js'

describe('GET /health', () => {
  it('健全なときは ok:true と allowlist:healthy を返す', async () => {
    const { app } = createTestApp()
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, allowlist: 'healthy' })
  })

  it('許可リストが縮退運転しているときも、プロセスは生存扱いのまま allowlist:degraded のみ返す（detail は公開しない）', async () => {
    const { app } = createTestApp({
      allowlistHealth: () => ({
        status: 'degraded',
        detail: '許可リストを取得できず、2026-08-24T00:20:00.000Z から直近の内容で縮退運転している',
      }),
    })
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, allowlist: 'degraded' })
  })

  it('猶予時間を過ぎて fail-closed に戻ったときは allowlist:unavailable を返す', async () => {
    const { app } = createTestApp({
      allowlistHealth: () => ({
        status: 'unavailable',
        detail: '許可リストを取得できず、fail-closed している',
      }),
    })
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, allowlist: 'unavailable' })
  })
})
