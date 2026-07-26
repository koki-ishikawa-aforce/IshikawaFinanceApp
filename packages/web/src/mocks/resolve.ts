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
  amazonProductKeyLearningRuleListFixture,
  assetTotalFixture,
  balanceTimeSeriesFixture,
  categoryBreakdownFixture,
  categoryListFixture,
  dashboardKpisFixture,
  expenseTypeListFixture,
  importStatusFixture,
  meFixture,
  merchantLearningRuleListFixture,
  monthlyLimitListFixture,
  monthlyReportFixture,
  onboardingMeFixture,
  ownAccountListFixture,
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
        return unclassifiedSummaryFixture()
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
      case '/api/classification/merchant-rules':
        return merchantLearningRuleListFixture()
      case '/api/classification/amazon-rules':
        return amazonProductKeyLearningRuleListFixture()
    }
  }

  throw new MockNotFoundError(method, pathname)
}
