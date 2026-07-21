import { Hono } from 'hono'
import { z } from 'zod'
import { YearMonthSchema, MonthlyReportIdSchema, NotFoundError } from '@warimaru/domain'
import type { MonthlyReportQuery } from '@warimaru/domain'
import type { AppEnv } from '../env.js'

const ByMonthParamsSchema = z.object({
  month: YearMonthSchema,
})

export function monthlyReportsRoutes(monthlyReportQuery: MonthlyReportQuery): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async c => {
    const params = ByMonthParamsSchema.parse({ month: c.req.query('month') })
    const viewerId = c.get('viewerId')
    const result = await monthlyReportQuery.fetchByMonth(viewerId, params.month)
    if (result === null) {
      throw new NotFoundError('MonthlyReport', params.month)
    }
    return c.json(result)
  })

  app.get('/:id', async c => {
    const id = MonthlyReportIdSchema.parse(c.req.param('id'))
    const viewerId = c.get('viewerId')
    const result = await monthlyReportQuery.fetchById(viewerId, id)
    if (result === null) {
      throw new NotFoundError('MonthlyReport', id)
    }
    return c.json(result)
  })

  return app
}
