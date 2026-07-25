import { describe, expect, it } from 'vitest'
import { createTestApp } from '../helpers/test-app.js'

/**
 * CORS 許可オリジンの実挙動 (#309)。
 * 許可リストは deps.allowedOrigins（環境変数 CORS_ALLOWED_ORIGINS 由来）で決まる。
 */
const ALLOWED = 'https://example.cloudfront.net'
const DENIED = 'https://attacker.example.com'

describe('CORS 許可オリジン (#309)', () => {
  it('許可オリジンからのリクエストには Access-Control-Allow-Origin を返す', async () => {
    const { app } = createTestApp({ allowedOrigins: [ALLOWED] })

    const res = await app.request('/health', { headers: { Origin: ALLOWED } })

    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED)
  })

  it('許可リスト外のオリジンには Access-Control-Allow-Origin を返さない', async () => {
    const { app } = createTestApp({ allowedOrigins: [ALLOWED] })

    const res = await app.request('/health', { headers: { Origin: DENIED } })

    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('プリフライト（OPTIONS）でも許可オリジンだけを通す', async () => {
    const { app } = createTestApp({ allowedOrigins: [ALLOWED] })

    const allowed = await app.request('/api/dashboard/kpis', {
      method: 'OPTIONS',
      headers: {
        Origin: ALLOWED,
        'Access-Control-Request-Method': 'GET',
      },
    })
    const denied = await app.request('/api/dashboard/kpis', {
      method: 'OPTIONS',
      headers: {
        Origin: DENIED,
        'Access-Control-Request-Method': 'GET',
      },
    })

    expect(allowed.headers.get('access-control-allow-origin')).toBe(ALLOWED)
    expect(denied.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('複数オリジンを許可した場合はいずれも通り、それ以外は通らない', async () => {
    const second = 'https://warimaru.example.com'
    const { app } = createTestApp({ allowedOrigins: [ALLOWED, second] })

    const first = await app.request('/health', { headers: { Origin: ALLOWED } })
    const other = await app.request('/health', { headers: { Origin: second } })
    const denied = await app.request('/health', { headers: { Origin: DENIED } })

    expect(first.headers.get('access-control-allow-origin')).toBe(ALLOWED)
    expect(other.headers.get('access-control-allow-origin')).toBe(second)
    expect(denied.headers.get('access-control-allow-origin')).toBeNull()
  })
})
