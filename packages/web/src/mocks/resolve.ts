/**
 * モック起動モード（NEXT_PUBLIC_MOCK=1）のリクエストルーター。
 *
 * api-client からのみ動的 import される（通常ビルドには読み込まれない）。
 * パスに対応する fixture を返し、未定義のパスは実 API の 404 相当として
 * {@link MockNotFoundError} を投げる（呼び出し側で ApiError に変換される）。
 */
import { getMockRole } from './role'
import { categoryBreakdownFixture, dashboardKpisFixture, meFixture } from './fixtures'

/** モックに fixture を用意していないパスへのアクセス（実 API の 404 相当） */
export class MockNotFoundError extends Error {
  readonly status = 404

  constructor(method: string, pathname: string) {
    super(`No mock fixture for ${method} ${pathname}`)
    this.name = 'MockNotFoundError'
  }
}

function parseMode(params: URLSearchParams): 'household' | 'personal' {
  return params.get('mode') === 'personal' ? 'personal' : 'household'
}

export function resolveMock(method: string, path: string): unknown {
  const [pathname = '', query = ''] = path.split('?')
  const params = new URLSearchParams(query)

  if (method === 'GET') {
    switch (pathname) {
      case '/api/me':
        return meFixture(getMockRole())
      case '/api/dashboard/kpis':
        return dashboardKpisFixture(parseMode(params))
      case '/api/dashboard/category-breakdown':
        return categoryBreakdownFixture(parseMode(params), params.get('month') ?? '2026-07')
    }
  }

  throw new MockNotFoundError(method, pathname)
}
