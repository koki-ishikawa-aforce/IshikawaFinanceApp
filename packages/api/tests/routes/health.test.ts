/**
 * GET /health（#650）
 *
 * 本体プロセスの生存(ok)とは別に、許可リストが縮退運転(degraded)しているかを
 * 外形監視が読み取れるようにする。
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

  it('許可リストが縮退運転しているときは、プロセスは生存扱いのまま allowlist:degraded を返す', async () => {
    const { app } = createTestApp({
      allowlistHealth: () => ({
        status: 'degraded',
        detail: '許可リストを取得できず、直近に取得できた内容で縮退運転している',
      }),
    })
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      allowlist: 'degraded',
      allowlistDetail: '許可リストを取得できず、直近に取得できた内容で縮退運転している',
    })
  })
})
