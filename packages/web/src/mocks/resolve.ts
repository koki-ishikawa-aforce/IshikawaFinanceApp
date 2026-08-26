/**
 * モック起動モード（NEXT_PUBLIC_MOCK=1）のリクエストルーター。
 *
 * api-client からのみ動的 import される（通常ビルドには読み込まれない）。
 * パスに対応する fixture を返し、未定義のパスは実 API の 404 相当として
 * {@link MockNotFoundError} を投げる（呼び出し側で ApiError に変換される）。
 */
import { YearMonthSchema, type DashboardMode, type YearMonth } from '@warimaru/domain'
import { MOCK_DEFAULT_MONTH } from './clock'
import { getMockRole } from './role'
import { getMockScenario } from './scenario'
import {
  accountBalanceListFixture,
  accountDetailFixture,
  assetTotalFixture,
  balanceFreshnessFixture,
  balanceTimeSeriesFixture,
  bulkClassificationAbortedFixture,
  bulkClassificationCompletedFixture,
  bulkClassificationSessionFixture,
  categoryBreakdownFixture,
  categoryListFixture,
  currentCycleFixture,
  dashboardKpisFixture,
  expenseSettlementViewFixture,
  expenseTypeListFixture,
  importStatusFixture,
  meFixture,
  merchantLearningRuleListFixture,
  monthlyLimitListFixture,
  monthlyReportFixture,
  onboardingMeFixture,
  ownAccountListFixture,
  pdfConversionFailedResponseFixture,
  retroactiveApplyResultFixture,
  retroactiveCandidatesFixture,
  settingsProfileFixture,
  spouseProfileFixture,
  transactionListFixture,
  unclassifiedSummaryFixture,
} from './fixtures'

/** 実 API の 4xx 応答に相当するモック応答（api-client が ApiError に変換する） */
export class MockErrorResponse extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Mock error ${status}`)
    this.name = 'MockErrorResponse'
  }
}

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

/** fixture が持つ標準の月。月指定が無い・壊れているときはここへ落とす */
const DEFAULT_MONTH = YearMonthSchema.parse(MOCK_DEFAULT_MONTH)

/**
 * 表示中の月。実 API は不正な月を弾くが、モックは画面を落とさず既定月で描画する
 * （プレビューの URL を手で書き換えたときに白画面にしない）。
 */
function parseMonth(params: URLSearchParams): YearMonth {
  const parsed = YearMonthSchema.safeParse(params.get('month'))
  return parsed.success ? parsed.data : DEFAULT_MONTH
}

export function resolveMock(method: string, path: string): unknown {
  const [pathname = '', query = ''] = path.split('?')
  const params = new URLSearchParams(query)

  if (method === 'GET') {
    switch (pathname) {
      case '/api/me':
        return meFixture(getMockRole())
      case '/api/dashboard/kpis':
        return dashboardKpisFixture(parseMode(params), getMockScenario())
      case '/api/dashboard/balance-freshness':
        return balanceFreshnessFixture(getMockScenario())
      case '/api/dashboard/category-breakdown':
        return categoryBreakdownFixture(parseMode(params), parseMonth(params))
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
        return accountBalanceListFixture(getMockScenario())
      case '/api/balances/total':
        return assetTotalFixture(getMockScenario())
      case '/api/balances/time-series':
        return balanceTimeSeriesFixture(getMockScenario())
      case '/api/expense-settlement':
        return expenseSettlementViewFixture(getMockRole(), parseMonth(params))
      case '/api/expense-settlement/cycles':
        return currentCycleFixture(parseMonth(params))
      case '/api/monthly-reports':
        return monthlyReportFixture(parseMonth(params))
      case '/api/settings/profile':
        return settingsProfileFixture(getMockRole())
      case '/api/settings/spouse-profile':
        return spouseProfileFixture(getMockRole())
      case '/api/accounts':
        return ownAccountListFixture(getMockRole(), getMockScenario())
      case '/api/monthly-limits':
        return monthlyLimitListFixture()
      case '/api/onboarding/me':
        return onboardingMeFixture()
      case '/api/imports/status':
        return importStatusFixture()
      case '/api/classification/merchant-rules':
        return merchantLearningRuleListFixture(getMockRole())
    }
    // 口座詳細（#406）は口座IDを含むため、固定のパス一覧では引けない
    const accountDetail = /^\/api\/balances\/accounts\/([^/]+)$/.exec(pathname)
    if (accountDetail !== null) {
      const fixture = accountDetailFixture(accountDetail[1] ?? '', getMockScenario())
      // 実 API は本人以外・未登録の口座を 404 にする。モックも同じ形で返す
      if (fixture === null) throw new MockNotFoundError(method, pathname)
      return fixture
    }
  }

  if (method === 'POST' && pathname === '/api/imports/pdf') {
    // 変換の成否は Anthropic API 次第でモックでは再現できない。画面確認の価値が高い
    // 失敗側（422 + 失敗ジョブ）を返す。成功系は CSV 取込で確認する
    throw new MockErrorResponse(422, JSON.stringify(pdfConversionFailedResponseFixture()))
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
    if (/^\/api\/classification\/bulk-sessions\/[^/]+\/progress$/.test(pathname)) {
      // 進捗はサーバー状態なので、モック起動モードでは記録前のセッションをそのまま返す
      return bulkClassificationSessionFixture(getMockRole())
    }
    if (/^\/api\/classification\/bulk-sessions\/[^/]+\/complete$/.test(pathname)) {
      return bulkClassificationCompletedFixture(getMockRole())
    }
    if (/^\/api\/classification\/bulk-sessions\/[^/]+\/abort$/.test(pathname)) {
      return bulkClassificationAbortedFixture(getMockRole())
    }
    if (/^\/api\/transactions\/[^/]+\/classify$/.test(pathname)) {
      // #582: 応答が実データの学習結果を持つようになったため、モックも同じ形にする
      return { merchantRuleLearned: true }
    }
  }

  throw new MockNotFoundError(method, pathname)
}
