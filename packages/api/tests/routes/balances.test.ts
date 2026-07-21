import { describe, it, expect } from 'vitest'
import { createTestApp, request } from '../helpers/test-app.js'

describe('GET /api/balances', () => {
  it('口座残高一覧ビューを返す', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/balances')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { items: unknown[] }).items).toEqual([])
  })
})

describe('GET /api/balances/total', () => {
  it('asOf 未指定は現在時刻で資産総額を返す', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/balances/total')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { asOf: string; total: number }
    expect(body.total).toBe(0)
    expect(new Date(body.asOf).getTime()).not.toBeNaN()
  })

  it('asOf 指定はその時点として渡される', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/balances/total?asOf=2026-07-01T00:00:00.000Z')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { asOf: string }).asOf).toBe('2026-07-01T00:00:00.000Z')
  })

  it('asOf が日付として解釈できなければ 400', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/balances/total?asOf=not-a-date')
    expect(res.status).toBe(400)
  })
})

describe('GET /api/balances/time-series', () => {
  it('from〜to の期間で推移ビューを返す', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/balances/time-series?from=2026-01&to=2026-07')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { yearMonthRange: { from: string; to: string } }
    expect(body.yearMonthRange).toEqual({ from: '2026-01', to: '2026-07' })
  })

  it('to 未指定は 400', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/balances/time-series?from=2026-01')
    expect(res.status).toBe(400)
  })

  it('from が不正な形式なら 400', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/balances/time-series?from=202601&to=2026-07')
    expect(res.status).toBe(400)
  })
})
