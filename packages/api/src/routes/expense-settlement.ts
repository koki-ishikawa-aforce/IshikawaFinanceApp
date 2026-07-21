import { Hono } from 'hono'
import { z } from 'zod'
import { YearMonthSchema } from '@warimaru/domain'
import type { ExpenseSettlementManagementQuery } from '@warimaru/domain'
import type { AppEnv } from '../env.js'

const QueryParamsSchema = z.object({
  month: YearMonthSchema.optional(),
})

export function expenseSettlementRoutes(
  expenseSettlementManagementQuery: ExpenseSettlementManagementQuery,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async c => {
    const params = QueryParamsSchema.parse({ month: c.req.query('month') })
    const viewerId = c.get('viewerId')
    const result = await expenseSettlementManagementQuery.fetch(viewerId, params.month)
    return c.json(result)
  })

  return app
}
