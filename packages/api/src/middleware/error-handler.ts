import type { Context } from 'hono'
import {
  DomainError,
  InvariantViolationError,
  NotFoundError,
  PermissionDeniedError,
} from '@warimaru/domain'
import { ZodError } from 'zod'

export function errorHandler(err: Error, c: Context): Response {
  if (err instanceof ZodError) {
    return c.json({ error: 'Validation error', details: err.flatten() }, 400)
  }
  if (err instanceof NotFoundError) {
    return c.json({ error: err.message }, 404)
  }
  if (err instanceof PermissionDeniedError) {
    return c.json({ error: err.message }, 403)
  }
  if (err instanceof InvariantViolationError) {
    return c.json({ error: err.message }, 409)
  }
  // 上の具象サブクラスに該当しない DomainError（基底クラスや将来のサブクラス）は
  // 内部エラー(500)ではなくクライアント起因(400)として扱う。
  // 想定外の DomainError サブクラスの取りこぼしに気づけるよう、サーバ側ログは残す。
  if (err instanceof DomainError) {
    console.error('Unmapped DomainError:', err)
    return c.json({ error: err.message }, 400)
  }
  console.error('Unhandled error:', err)
  return c.json({ error: 'Internal server error' }, 500)
}
