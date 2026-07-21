import type { MiddlewareHandler } from 'hono'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { UserIdSchema } from '@warimaru/domain'
import type { AppEnv } from '../env.js'

const LINE_JWKS_URL = new URL('https://api.line.me/oauth2/v2.1/certs')
const jwks = createRemoteJWKSet(LINE_JWKS_URL)

export const lineAuthMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing Authorization header' }, 401)
  }

  const idToken = authHeader.slice(7)
  const channelId = process.env['LINE_LOGIN_CHANNEL_ID']
  if (!channelId) {
    return c.json({ error: 'LINE_LOGIN_CHANNEL_ID is not configured' }, 500)
  }

  try {
    const { payload } = await jwtVerify(idToken, jwks, {
      issuer: 'https://access.line.me',
      audience: channelId,
    })

    const sub = payload.sub
    const result = UserIdSchema.safeParse(sub)
    if (!result.success) {
      return c.json({ error: 'Invalid LINE user ID in token' }, 401)
    }

    c.set('viewerId', result.data)
    await next()
  } catch {
    return c.json({ error: 'Invalid or expired LINE ID token' }, 401)
  }
}
