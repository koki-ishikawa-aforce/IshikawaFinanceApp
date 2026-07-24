import { describe, it, expect } from 'vitest'
import {
  MonthlyReportIdSchema,
  MonthlyReportViewSchema,
  UserIdSchema,
  YearMonthSchema,
} from '@warimaru/domain'
import type { MonthlyReportQuery, MonthlyReportView } from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-neon'
import { createTestApp, request, VIEWER_ID } from '../helpers/test-app.js'

function buildView(month: string): MonthlyReportView {
  return MonthlyReportViewSchema.parse({
    status: 'csv_confirmed',
    common: {
      monthlyReportId: MonthlyReportIdSchema.parse(newUlid()),
      targetYearMonth: month,
      householdCategoryTotals: [],
      personalTotalHoney: 0,
      personalTotalDarling: 0,
      businessExpenseTotalSelf: 0,
      nisaContributionAccumulated: 0,
      balanceTrend: {
        smbcBalanceTrend: [],
        otherSavingsBalanceTrend: [],
        nisaContributionTrend: [],
        cardUnpaidTrend: [],
      },
    },
    csvConfirmedAt: new Date('2026-08-01T00:00:00Z'),
    finalizedAt: null,
    unapprovedTransfers: null,
  })
}

/** Query 呼び出しの引数（viewer スコープ）検証用スタブ */
function stubQuery(view: MonthlyReportView, calls: unknown[][]): MonthlyReportQuery {
  return {
    async fetchByMonth(viewerId, month) {
      calls.push([viewerId, month])
      return view
    },
    async fetchById(viewerId, id) {
      calls.push([viewerId, id])
      return view
    },
  }
}

describe('GET /api/monthly-reports?month=', () => {
  it('viewer と month が Query に渡り、ビューを返す', async () => {
    const calls: unknown[][] = []
    const view = buildView('2026-07')
    const t = createTestApp({ monthlyReportQuery: stubQuery(view, calls) })
    const res = await request(t.app, 'GET', '/api/monthly-reports?month=2026-07')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; common: { targetYearMonth: string } }
    expect(body.status).toBe('csv_confirmed')
    expect(body.common.targetYearMonth).toBe('2026-07')
    expect(calls).toEqual([[UserIdSchema.parse(VIEWER_ID), YearMonthSchema.parse('2026-07')]])
  })

  it('レポート未作成の月は 404', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/monthly-reports?month=2026-07')
    expect(res.status).toBe(404)
  })

  it('month 未指定は 400', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/monthly-reports')
    expect(res.status).toBe(400)
  })

  it('month が不正な形式なら 400', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/monthly-reports?month=2026/07')
    expect(res.status).toBe(400)
  })
})

describe('GET /api/monthly-reports/:id', () => {
  it('ID 指定でビューを返す', async () => {
    const calls: unknown[][] = []
    const view = buildView('2026-06')
    const t = createTestApp({ monthlyReportQuery: stubQuery(view, calls) })
    const res = await request(t.app, 'GET', `/api/monthly-reports/${view.common.monthlyReportId}`)
    expect(res.status).toBe(200)
    expect(
      ((await res.json()) as { common: { monthlyReportId: string } }).common.monthlyReportId,
    ).toBe(view.common.monthlyReportId)
  })

  it('存在しない ID は 404', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', `/api/monthly-reports/${newUlid()}`)
    expect(res.status).toBe(404)
  })

  it('ULID 形式でない ID は 400', async () => {
    const t = createTestApp()
    const res = await request(t.app, 'GET', '/api/monthly-reports/not-a-ulid')
    expect(res.status).toBe(400)
  })
})
