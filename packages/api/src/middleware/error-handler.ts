import type { Context } from 'hono'
import {
  ConcurrentUpdateError,
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
  // 版数照合の失敗（#459）。読み出し後に別の更新が入った一時的な競合で、やり直せば通る。
  // InvariantViolationError より前に置く（サブクラスではないため順序は問わないが、
  // 409 の意味を「不変条件違反」と「並行更新の競合」で取り違えないよう明示的に分ける）。
  if (err instanceof ConcurrentUpdateError) {
    return c.json({ error: err.message }, 409)
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
