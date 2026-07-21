import { Hono } from 'hono'
import { z } from 'zod'
import { YearMonthSchema } from '@warimaru/domain'
import type { AccountBalanceQuery, BalanceTimeSeriesQuery } from '@warimaru/domain'
import type { AppEnv } from '../env.js'

const TotalParamsSchema = z.object({
  asOf: z.coerce.date().optional(),
})

const TimeSeriesParamsSchema = z.object({
  from: YearMonthSchema,
  to: YearMonthSchema,
})

export function balancesRoutes(
  accountBalanceQuery: AccountBalanceQuery,
  balanceTimeSeriesQuery: BalanceTimeSeriesQuery,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async c => {
    const result = await accountBalanceQuery.fetchBalanceList()
    return c.json(result)
  })

  app.get('/total', async c => {
    const params = TotalParamsSchema.parse({ asOf: c.req.query('asOf') })
    const result = await accountBalanceQuery.fetchAssetTotal(params.asOf ?? new Date())
    return c.json(result)
  })

  app.get('/time-series', async c => {
    const params = TimeSeriesParamsSchema.parse({
      from: c.req.query('from'),
      to: c.req.query('to'),
    })
    const result = await balanceTimeSeriesQuery.fetch(params.from, params.to)
    return c.json(result)
  })

  return app
}
