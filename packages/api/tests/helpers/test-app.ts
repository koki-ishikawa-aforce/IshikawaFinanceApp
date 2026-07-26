/**
 * エンドポイントテスト用のアプリ組み立てヘルパー。
 * composition-root のモック合成（DATABASE_URL 未設定時に createDeps が委ねる先と同じ関数）を使う。
 * NODE_ENV != production のため X-User-Id ヘッダー認証（devViewerIdMiddleware）が有効になる。
 */
import type { Hono } from 'hono'
import type { UserId } from '@warimaru/domain'
import { UserIdSchema } from '@warimaru/domain'
import { createApp } from '../../src/app.js'
import { createMockDeps, type AppDeps } from '../../src/composition-root.js'
import type { AppEnv } from '../../src/env.js'

export const VIEWER_ID: UserId = UserIdSchema.parse('user-honey-test')
export const SPOUSE_ID: UserId = UserIdSchema.parse('user-darling-test')

export interface TestApp {
  app: Hono<AppEnv>
  deps: AppDeps
}

export function createTestApp(overrides: Partial<AppDeps> = {}): TestApp {
  const deps = { ...createMockDeps({}), ...overrides }
  const app = createApp(deps)
  return { app, deps }
}

/** X-User-Id 付きの JSON リクエスト */
export async function request(
  app: Hono<AppEnv>,
  method: string,
  path: string,
  options: { body?: unknown; viewerId?: UserId | undefined; formData?: FormData } = {},
): Promise<Response> {
  const viewerId = options.viewerId ?? VIEWER_ID
  if (options.formData !== undefined) {
    return app.request(path, {
      method,
      headers: { 'X-User-Id': viewerId },
      body: options.formData,
    })
  }
  return app.request(path, {
    method,
    headers: {
      'X-User-Id': viewerId,
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  })
}
