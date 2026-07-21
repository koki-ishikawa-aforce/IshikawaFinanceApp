import type { MiddlewareHandler } from 'hono'
import { UserIdSchema } from '@warimaru/domain'
import type { AppEnv } from '../env.js'

export const viewerIdMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const raw = c.req.header('X-User-Id') ?? process.env['DEFAULT_USER_ID'] ?? ''
  const result = UserIdSchema.safeParse(raw)
  if (!result.success) {
    return c.json({ error: 'Missing or invalid X-User-Id header' }, 401)
  }
  c.set('viewerId', result.data)
  await next()
}
