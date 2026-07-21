import { Hono } from 'hono'
import { z } from 'zod'
import { YearMonthSchema } from '@warimaru/domain'
import type { CsvImportStatusQuery } from '@warimaru/domain'
import type { AppEnv } from '../env.js'

const StatusParamsSchema = z.object({
  month: YearMonthSchema,
})

export function importsRoutes(csvImportStatusQuery: CsvImportStatusQuery): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/status', async c => {
    const params = StatusParamsSchema.parse({ month: c.req.query('month') })
    const viewerId = c.get('viewerId')
    const completion = await csvImportStatusQuery.fetchCompletion(viewerId, params.month)
    return c.json({ completion })
  })

  return app
}
