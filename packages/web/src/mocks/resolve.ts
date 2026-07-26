/**
 * モック起動モード（NEXT_PUBLIC_MOCK=1）のリクエストルーター。
 *
 * api-client からのみ動的 import される（通常ビルドには読み込まれない）。
 * パスに対応する fixture を返し、未定義のパスは実 API の 404 相当として
 * {@link MockNotFoundError} を投げる（呼び出し側で ApiError に変換される）。
 */
import type { DashboardMode } from '@warimaru/domain'
import { getMockRole } from './role'
import {
  accountBalanceListFixture,
  assetTotalFixture,
  balanceTimeSeriesFixture,
  bulkClassificationAbortedFixture,
  bulkClassificationCompletedFixture,
  bulkClassificationSessionFixture,
  categoryBreakdownFixture,
  categoryListFixture,
  dashboardKpisFixture,
  expenseTypeListFixture,
  importStatusFixture,
  meFixture,
  monthlyLimitListFixture,
  monthlyReportFixture,
  onboardingMeFixture,
  ownAccountListFixture,
  retroactiveApplyResultFixture,
  retroactiveCandidatesFixture,
  settingsProfileFixture,
  transactionListFixture,
  unclassifiedSummaryFixture,
} from './fixtures'

/** モックに fixture を用意していないパスへのアクセス（実 API の 404 相当） */
export class MockNotFoundError extends Error {
  readonly status = 404

  constructor(method: string, pathname: string) {
    super(`No mock fixture for ${method} ${pathname}`)
    this.name = 'MockNotFoundError'
  }
}

function parseMode(params: URLSearchParams): DashboardMode {
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
      case '/api/transactions':
        return transactionListFixture(getMockRole())
      case '/api/transactions/unclassified-summary':
        return unclassifiedSummaryFixture(getMockRole())
      case '/api/classification/bulk-sessions/current':
        // 進行中のセッションが無い状態を既定にする（「まとめて分類する」の導線が出る）
        return { session: null }
      case '/api/classification/retroactive-candidates':
        return retroactiveCandidatesFixture(getMockRole(), params.get('merchantName') ?? '')
      case '/api/categories':
        return categoryListFixture()
      case '/api/expense-types':
        return expenseTypeListFixture()
      case '/api/balances':
        return accountBalanceListFixture()
      case '/api/balances/total':
        return assetTotalFixture()
      case '/api/balances/time-series':
        return balanceTimeSeriesFixture()
      case '/api/monthly-reports':
        return monthlyReportFixture(params.get('month') ?? '2026-07')
      case '/api/settings/profile':
        return settingsProfileFixture(getMockRole())
      case '/api/accounts':
        return ownAccountListFixture()
      case '/api/monthly-limits':
        return monthlyLimitListFixture()
      case '/api/onboarding/me':
        return onboardingMeFixture()
      case '/api/imports/status':
        return importStatusFixture()
    }
  }

  // 一括分類・遡及適用は操作して初めて画面が現れるため、モック起動モードでも
  // 書き込み系を返す（サーバー状態は持たないので、同じ入力には常に同じ応答を返す）
  if (method === 'POST' || method === 'PUT') {
    if (pathname === '/api/classification/bulk-sessions') {
      return bulkClassificationSessionFixture(getMockRole())
    }
    if (pathname === '/api/classification/retroactive-candidates/apply') {
      return retroactiveApplyResultFixture()
    }
    if (/^\/api\/classification\/bulk-sessions\/[^/]+\/complete$/.test(pathname)) {
      return bulkClassificationCompletedFixture(getMockRole())
    }
    if (/^\/api\/classification\/bulk-sessions\/[^/]+\/abort$/.test(pathname)) {
      return bulkClassificationAbortedFixture(getMockRole())
    }
    if (/^\/api\/transactions\/[^/]+\/classify$/.test(pathname)) {
      return {}
    }
  }

  throw new MockNotFoundError(method, pathname)
}
