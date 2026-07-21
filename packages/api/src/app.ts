import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { AppDeps } from './composition-root.js'
import type { AppEnv } from './env.js'
import { dashboardRoutes } from './routes/dashboard.js'
import { viewerIdMiddleware } from './middleware/viewer-id.js'
import { errorHandler } from './middleware/error-handler.js'

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.use('*', cors({ origin: ['http://localhost:3000'] }))
  app.use('/api/*', viewerIdMiddleware)
  app.onError(errorHandler)

  app.route('/api/dashboard', dashboardRoutes(deps.dashboardQuery))

  app.get('/health', c => c.json({ ok: true }))

  return app
}
