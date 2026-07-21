import { Hono } from 'hono'
import type { ExpenseSettlementManagementQuery } from '@warimaru/domain'
import type { AppEnv } from '../env.js'

export function expenseSettlementRoutes(
  expenseSettlementManagementQuery: ExpenseSettlementManagementQuery,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async c => {
    const viewerId = c.get('viewerId')
    const result = await expenseSettlementManagementQuery.fetch(viewerId)
    return c.json(result)
  })

  return app
}
