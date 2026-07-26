import { Hono } from 'hono'
import { z } from 'zod'
import { YearMonthSchema } from '@warimaru/domain'
import type { DashboardQuery } from '@warimaru/domain'
import type { AppEnv } from '../env.js'

const QueryParamsSchema = z.object({
  month: YearMonthSchema,
  mode: z.enum(['household', 'personal']),
})

export function dashboardRoutes(dashboardQuery: DashboardQuery): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/kpis', async c => {
    const params = QueryParamsSchema.parse({
      month: c.req.query('month'),
      mode: c.req.query('mode'),
    })
    const viewerId = c.get('viewerId')
    const result = await dashboardQuery.fetchKpis(viewerId, params.month, params.mode)
    return c.json(result)
  })

  // 残高鮮度は現在時点の評価のため month / mode を取らない。口座単位の残高情報は
  // 本人のみ可視（P2-B5 / AT-404）なので viewer で絞り込む
  app.get('/balance-freshness', async c => {
    const viewerId = c.get('viewerId')
    const result = await dashboardQuery.fetchBalanceFreshness(viewerId)
    return c.json(result)
  })

  app.get('/category-breakdown', async c => {
    const params = QueryParamsSchema.parse({
      month: c.req.query('month'),
      mode: c.req.query('mode'),
    })
    const viewerId = c.get('viewerId')
    const result = await dashboardQuery.fetchCategoryBreakdown(viewerId, params.month, params.mode)
    return c.json(result)
  })

  return app
}
