import { Hono } from 'hono'
import type { UserId, UserRole } from '@warimaru/domain'
import type { AppEnv } from '../env.js'

type ResolveViewerRole = (viewerId: UserId) => Promise<UserRole>

export function meRoutes(resolveViewerRole: ResolveViewerRole): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async c => {
    const viewerId = c.get('viewerId')
    const role = await resolveViewerRole(viewerId)
    return c.json({ viewerId, role })
  })

  return app
}
