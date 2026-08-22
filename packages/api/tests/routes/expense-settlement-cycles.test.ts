import { describe, it, expect } from 'vitest'
import type { MonthlyExpenseCycleStarted } from '@warimaru/domain'
import { SPOUSE_ID, VIEWER_ID, createTestApp, request, type TestApp } from '../helpers/test-app.js'

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

describe('POST /api/expense-settlement/cycles（手動開始）', () => {
  function collectStarted(t: TestApp): MonthlyExpenseCycleStarted[] {
    const log: MonthlyExpenseCycleStarted[] = []
    t.deps.eventBus.subscribe<MonthlyExpenseCycleStarted>('MonthlyExpenseCycleStarted', e => {
      log.push(e)
    })
    return log
  }

  it('累計が空の集積中サイクルを返し、MonthlyExpenseCycleStarted が発行される（自動開始と同じ経路）', async () => {
    const t = createTestApp()
    const log = collectStarted(t)

    const res = await request(t.app, 'POST', '/api/expense-settlement/cycles', {
      body: { targetMonth: '2026-07' },
    })

    expect(res.status).toBe(201)
    const created = (await res.json()) as {
      kind: string
      common: { monthlyExpenseCycleId: string; cycleStartedAt: string }
    }
    expect(created).toMatchObject({
      kind: 'accumulating',
      common: {
        userId: VIEWER_ID,
        targetYearMonth: '2026-07',
        accumulations: [],
        childTransactionRefs: [],
      },
    })
    expect(created.common.cycleStartedAt).toBeTruthy()
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({
      userId: VIEWER_ID,
      targetYearMonth: '2026-07',
      monthlyExpenseCycleId: created.common.monthlyExpenseCycleId,
    })
  })

  it('同じ月を二重に開始できず、2 回目の開始イベントも発行されない', async () => {
    const t = createTestApp()
    const log = collectStarted(t)
    await request(t.app, 'POST', '/api/expense-settlement/cycles', {
      body: { targetMonth: '2026-07' },
    })

    const res = await request(t.app, 'POST', '/api/expense-settlement/cycles', {
      body: { targetMonth: '2026-07' },
    })

    expect(res.status).toBe(409)
    // 月初バッチが先に開始した場合にも出る文言。次の操作（再読込）まで示し、サイクル ID は出さない
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('すでに開始済み')
    expect(body.error).toContain('再読み込み')
    expect(log).toHaveLength(1)
  })

  it.each(['2026-7', '2026-13', undefined])('targetMonth が %s なら 400', async targetMonth => {
    const t = createTestApp()
    const res = await request(t.app, 'POST', '/api/expense-settlement/cycles', {
      body: targetMonth === undefined ? {} : { targetMonth },
    })
    expect(res.status).toBe(400)
  })

  it('X-User-Id が無ければ 401（開始は本人のぶんだけ）', async () => {
    const t = createTestApp()
    const res = await t.app.request('/api/expense-settlement/cycles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetMonth: '2026-07' }),
    })
    expect(res.status).toBe(401)
  })
})
