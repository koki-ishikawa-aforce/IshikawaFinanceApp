import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { AppDeps } from './composition-root.js'
import { isProduction, type AppEnv } from './env.js'
import { dashboardRoutes } from './routes/dashboard.js'
import { meRoutes } from './routes/me.js'
import { transactionsRoutes } from './routes/transactions.js'
import { monthlyReportsRoutes } from './routes/monthly-reports.js'
import { balancesRoutes } from './routes/balances.js'
import { accountsRoutes } from './routes/accounts.js'
import { settingsRoutes } from './routes/settings.js'
import { expenseSettlementRoutes } from './routes/expense-settlement.js'
import { importsRoutes } from './routes/imports.js'
import { categoriesRoutes } from './routes/categories.js'
import { expenseTypesRoutes } from './routes/expense-types.js'
import { monthlyLimitsRoutes } from './routes/monthly-limits.js'
import { classificationRoutes } from './routes/classification.js'
import { onboardingRoutes } from './routes/onboarding.js'
import { gmailOAuthRoutes } from './routes/gmail-oauth.js'
import { lineAuthMiddleware } from './middleware/line-auth.js'
import { devViewerIdMiddleware } from './middleware/viewer-id.js'
import { errorHandler } from './middleware/error-handler.js'
import { registerEventHandlers } from './event-handlers/index.js'

// 本番判定は composition-root.ts と同じ isProduction() に統一する。
// 判定基準が食い違うと、DB は本番なのに認証はなりすまし可能な dev、という
// fail-open の窓が生まれるため（NODE_ENV=" Production" 等）。
const isDev = !isProduction()

export function createApp(deps: AppDeps): Hono<AppEnv> {
  // イベントハンドラーは最終的な deps（テストの override 込み）で登録する
  registerEventHandlers(deps)

  const app = new Hono<AppEnv>()

  app.use('*', cors({ origin: ['http://localhost:3000'] }))
  app.use('/api/*', isDev ? devViewerIdMiddleware : lineAuthMiddleware)
  app.onError(errorHandler)

  app.route('/api/me', meRoutes(deps.resolveViewerRole))
  app.route(
    '/api/onboarding',
    onboardingRoutes({
      appUserRepository: deps.appUserRepository,
      accountRepository: deps.accountRepository,
      spouseCompletionQuery: deps.spouseCompletionQuery,
      allowlistQuery: deps.allowlistQuery,
      gmailOAuthGateway: deps.gmailOAuthGateway,
      eventBus: deps.eventBus,
    }),
  )
  // Gmail OAuth コールバックは OS 標準ブラウザから到達するため LIFF 認証（/api/*）の外に置く
  app.route(
    '/oauth/gmail',
    gmailOAuthRoutes({
      appUserRepository: deps.appUserRepository,
      gmailOAuthTokenRepository: deps.gmailOAuthTokenRepository,
      gmailOAuthGateway: deps.gmailOAuthGateway,
      eventBus: deps.eventBus,
    }),
  )
  app.route('/api/dashboard', dashboardRoutes(deps.dashboardQuery))
  app.route(
    '/api/transactions',
    transactionsRoutes(
      deps.transactionListQuery,
      deps.transactionRepository,
      deps.resolveViewerRole,
      deps.eventBus,
    ),
  )
  app.route('/api/monthly-reports', monthlyReportsRoutes(deps.monthlyReportQuery))
  app.route('/api/balances', balancesRoutes(deps.accountBalanceQuery, deps.balanceTimeSeriesQuery))
  app.route(
    '/api/accounts',
    accountsRoutes({
      accountRepository: deps.accountRepository,
      eventBus: deps.eventBus,
    }),
  )
  app.route(
    '/api/settings',
    settingsRoutes({
      appUserRepository: deps.appUserRepository,
      resolveViewerRole: deps.resolveViewerRole,
      eventBus: deps.eventBus,
    }),
  )
  app.route(
    '/api/expense-settlement',
    expenseSettlementRoutes({
      expenseSettlementManagementQuery: deps.expenseSettlementManagementQuery,
      monthlyExpenseCycleRepository: deps.monthlyExpenseCycleRepository,
      proratedChildTransactionRepository: deps.proratedChildTransactionRepository,
      expenseReimbursementDepositRepository: deps.expenseReimbursementDepositRepository,
      resolveViewerRole: deps.resolveViewerRole,
      eventBus: deps.eventBus,
    }),
  )
  app.route(
    '/api/imports',
    importsRoutes({
      csvImportStatusQuery: deps.csvImportStatusQuery,
      statementImportJobRepository: deps.statementImportJobRepository,
      transactionCandidateRepository: deps.transactionCandidateRepository,
      dailyMailImportBatchRepository: deps.dailyMailImportBatchRepository,
      transactionRepository: deps.transactionRepository,
      pdfToCsvConverter: deps.pdfToCsvConverter,
      resolveViewerRole: deps.resolveViewerRole,
    }),
  )
  app.route(
    '/api/categories',
    categoriesRoutes({
      categoryMasterRepository: deps.categoryMasterRepository,
      expenseTypeMasterRepository: deps.expenseTypeMasterRepository,
      categoryDeletionRequestRepository: deps.categoryDeletionRequestRepository,
      eventBus: deps.eventBus,
    }),
  )
  app.route(
    '/api/expense-types',
    expenseTypesRoutes({
      expenseTypeMasterRepository: deps.expenseTypeMasterRepository,
      expenseTypeDeletionRequestRepository: deps.expenseTypeDeletionRequestRepository,
      monthlyLimitRepository: deps.monthlyLimitRepository,
      eventBus: deps.eventBus,
    }),
  )
  app.route(
    '/api/monthly-limits',
    monthlyLimitsRoutes(deps.monthlyLimitRepository, deps.expenseTypeMasterRepository),
  )
  app.route(
    '/api/classification',
    classificationRoutes({
      retroactiveCandidateQuery: deps.retroactiveCandidateQuery,
      merchantLearningRuleRepository: deps.merchantLearningRuleRepository,
      amazonProductKeyLearningRuleRepository: deps.amazonProductKeyLearningRuleRepository,
      bulkClassificationSessionRepository: deps.bulkClassificationSessionRepository,
      transactionRepository: deps.transactionRepository,
      resolveViewerRole: deps.resolveViewerRole,
      eventBus: deps.eventBus,
    }),
  )

  app.get('/health', c => c.json({ ok: true }))

  return app
}
