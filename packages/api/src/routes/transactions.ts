import { Hono } from 'hono'
import { z } from 'zod'
import { YearMonthSchema, ExpenseClassSchema } from '@warimaru/domain'
import type { TransactionListQuery, TransactionListFilter } from '@warimaru/domain'
import type { AppEnv } from '../env.js'

const ListParamsSchema = z.object({
  month: YearMonthSchema,
  expenseClass: ExpenseClassSchema.optional(),
  isUnclassifiedOnly: z.enum(['true', 'false']).optional(),
})

const SummaryParamsSchema = z.object({
  month: YearMonthSchema,
})

export function transactionsRoutes(transactionListQuery: TransactionListQuery): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async c => {
    const params = ListParamsSchema.parse({
      month: c.req.query('month'),
      expenseClass: c.req.query('expenseClass'),
      isUnclassifiedOnly: c.req.query('isUnclassifiedOnly'),
    })
    const filter: TransactionListFilter = { month: params.month }
    if (params.expenseClass !== undefined) {
      filter.expenseClass = params.expenseClass
    }
    if (params.isUnclassifiedOnly !== undefined) {
      filter.isUnclassifiedOnly = params.isUnclassifiedOnly === 'true'
    }
    const viewerId = c.get('viewerId')
    const result = await transactionListQuery.fetch(viewerId, filter)
    return c.json(result)
  })

  app.get('/unclassified-summary', async c => {
    const params = SummaryParamsSchema.parse({ month: c.req.query('month') })
    const viewerId = c.get('viewerId')
    const result = await transactionListQuery.fetchUnclassifiedSummary(viewerId, params.month)
    return c.json(result)
  })

  return app
}
