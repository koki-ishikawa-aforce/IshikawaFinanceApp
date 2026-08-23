import { Hono } from 'hono'
import { z } from 'zod'
import { YearMonthSchema } from '@warimaru/domain'
import type { AccountBalanceQuery, BalanceTimeSeriesQuery } from '@warimaru/domain'
import type { AppEnv } from '../env.js'

const TotalParamsSchema = z.object({
  asOf: z.coerce.date().optional(),
})

/**
 * 推移グラフの期間。読み出し元が残高変動履歴（1 変動 = 1 行）に変わり、返す行数が
 * 履歴の蓄積量に比例するようになったため上限を課す（#398）。'YYYY-MM' はゼロ埋めで
 * 辞書順比較が時系列順と一致する。
 */
const MAX_TIME_SERIES_MONTHS = 120

const TimeSeriesParamsSchema = z
  .object({
    from: YearMonthSchema,
    to: YearMonthSchema,
  })
  .superRefine((params, ctx) => {
    if (params.from > params.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'from は to 以前である必要があります',
        path: ['from'],
      })
      return
    }
    const monthsOf = (ym: string): number => {
      const [year, month] = ym.split('-').map(Number) as [number, number]
      return year * 12 + month
    }
    if (monthsOf(params.to) - monthsOf(params.from) + 1 > MAX_TIME_SERIES_MONTHS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `期間は最大 ${MAX_TIME_SERIES_MONTHS} か月です`,
        path: ['to'],
      })
    }
  })

export function balancesRoutes(
  accountBalanceQuery: AccountBalanceQuery,
  balanceTimeSeriesQuery: BalanceTimeSeriesQuery,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async c => {
    const result = await accountBalanceQuery.fetchBalanceList(c.get('viewerId'))
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
    const result = await balanceTimeSeriesQuery.fetch(c.get('viewerId'), params.from, params.to)
    return c.json(result)
  })

  return app
}
