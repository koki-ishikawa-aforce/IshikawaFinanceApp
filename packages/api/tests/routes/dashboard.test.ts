import { describe, it, expect } from 'vitest'
import { CategoryBreakdownViewSchema, DashboardKpisViewSchema } from '@warimaru/domain'
import type { DashboardMode, DashboardQuery, UserId, YearMonth } from '@warimaru/domain'
import { createTestApp, request, VIEWER_ID } from '../helpers/test-app.js'

interface QueryCall {
  method: 'fetchKpis' | 'fetchCategoryBreakdown'
  viewerId: UserId
  month: YearMonth
  mode: DashboardMode
}

/** viewer スコープ・パラメータ伝搬の検証用スタブ */
function stubDashboardQuery(calls: QueryCall[]): DashboardQuery {
  return {
    async fetchKpis(viewerId, month, mode) {
      calls.push({ method: 'fetchKpis', viewerId, month, mode })
      return DashboardKpisViewSchema.parse({
        mode,
        currentMonthSpending: 187500,
        spousePersonalTotal: 64000,
        savingsBalance: 2450000,
        nisaContributionAccumulated: 360000,
        totalAssets: 2760000,
      })
    },
    async fetchCategoryBreakdown(viewerId, month, mode) {
      calls.push({ method: 'fetchCategoryBreakdown', viewerId, month, mode })
      return CategoryBreakdownViewSchema.parse({
        mode,
        yearMonth: month,
        totalAmount: 0,
        items: [],
      })
    },
  }
}

describe('GET /api/dashboard/kpis', () => {
  it('viewer と month・mode が Query に渡り、KPI ビューを返す', async () => {
    const calls: QueryCall[] = []
    const t = createTestApp({ dashboardQuery: stubDashboardQuery(calls) })
    const res = await request(t.app, 'GET', '/api/dashboard/kpis?month=2026-07&mode=household')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      mode: string
      currentMonthSpending: number
      totalAssets: number
    }
    expect(body.mode).toBe('household')
    expect(body.currentMonthSpending).toBe(187500)
    expect(body.totalAssets).toBe(2760000)
    expect(calls).toEqual([
      { method: 'fetchKpis', viewerId: VIEWER_ID, month: '2026-07', mode: 'household' },
    ])
  })

  it('mode=personal が個人モードとして伝わる', async () => {
    const calls: QueryCall[] = []
    const t = createTestApp({ dashboardQuery: stubDashboardQuery(calls) })
    const res = await request(t.app, 'GET', '/api/dashboard/kpis?month=2026-07&mode=personal')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { mode: string }).mode).toBe('personal')
    expect(calls[0]?.mode).toBe('personal')
  })

  it('month 未指定は 400', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/dashboard/kpis?mode=household')
    expect(res.status).toBe(400)
  })

  it('month が不正な形式なら 400', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/dashboard/kpis?month=2026-13&mode=household')
    expect(res.status).toBe(400)
  })

  it('mode が不正な値なら 400', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/dashboard/kpis?month=2026-07&mode=all')
    expect(res.status).toBe(400)
  })
})

describe('GET /api/dashboard/category-breakdown', () => {
  it('viewer と month・mode が Query に渡り、カテゴリ内訳ビューを返す', async () => {
    const calls: QueryCall[] = []
    const t = createTestApp({ dashboardQuery: stubDashboardQuery(calls) })
    const res = await request(
      t.app,
      'GET',
      '/api/dashboard/category-breakdown?month=2026-07&mode=household',
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { mode: string; yearMonth: string }
    expect(body.mode).toBe('household')
    expect(body.yearMonth).toBe('2026-07')
    expect(calls).toEqual([
      {
        method: 'fetchCategoryBreakdown',
        viewerId: VIEWER_ID,
        month: '2026-07',
        mode: 'household',
      },
    ])
  })

  it('mode 未指定は 400', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/dashboard/category-breakdown?month=2026-07')
    expect(res.status).toBe(400)
  })
})
