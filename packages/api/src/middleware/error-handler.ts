import type { Context } from 'hono'
import { InvariantViolationError, NotFoundError, PermissionDeniedError } from '@warimaru/domain'
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
  console.error('Unhandled error:', err)
  return c.json({ error: 'Internal server error' }, 500)
}
