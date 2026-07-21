import type { MiddlewareHandler } from 'hono'
import { UserIdSchema } from '@warimaru/domain'
import type { AppEnv } from '../env.js'

/**
 * 開発環境専用フォールバック。X-User-Id ヘッダーまたは DEFAULT_USER_ID 環境変数で
 * ユーザーを特定する。NODE_ENV=development 時のみ使用される。
 */
export const devViewerIdMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const raw = c.req.header('X-User-Id') ?? process.env['DEFAULT_USER_ID'] ?? ''
  const result = UserIdSchema.safeParse(raw)
  if (!result.success) {
    return c.json({ error: 'Missing or invalid X-User-Id header' }, 401)
  }
  c.set('viewerId', result.data)
  await next()
}
