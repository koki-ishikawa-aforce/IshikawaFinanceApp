import { describe, it, expect } from 'vitest'
import { SPOUSE_ID, createTestApp, request } from '../helpers/test-app.js'

describe('GET /api/expense-settlement/cycles', () => {
  it('未開始の月は cycle: null を返す', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/expense-settlement/cycles?month=2026-07')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ cycle: null })
  })

  it('開始済みの月は自分のサイクルを返す', async () => {
    const t = createTestApp()
    const createRes = await request(t.app, 'POST', '/api/expense-settlement/cycles', {
      body: { targetMonth: '2026-07' },
    })
    expect(createRes.status).toBe(201)

    const res = await request(t.app, 'GET', '/api/expense-settlement/cycles?month=2026-07')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      cycle: { kind: string; common: { targetYearMonth: string } }
    }
    expect(body.cycle.kind).toBe('accumulating')
    expect(body.cycle.common.targetYearMonth).toBe('2026-07')
  })

  it('他ユーザーのサイクルは返さない（viewer スコープ）', async () => {
    const t = createTestApp()
    await request(t.app, 'POST', '/api/expense-settlement/cycles', {
      body: { targetMonth: '2026-07' },
    })
    const res = await request(t.app, 'GET', '/api/expense-settlement/cycles?month=2026-07', {
      viewerId: SPOUSE_ID,
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ cycle: null })
  })

  it('month 未指定は 400', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/expense-settlement/cycles')
    expect(res.status).toBe(400)
  })

  it('month が不正な形式なら 400', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/expense-settlement/cycles?month=2026-7')
    expect(res.status).toBe(400)
  })
})
