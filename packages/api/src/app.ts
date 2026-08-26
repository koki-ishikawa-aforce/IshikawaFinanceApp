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
import { bankDepositsRoutes } from './routes/bank-deposits.js'
import { settingsRoutes } from './routes/settings.js'
import { expenseSettlementRoutes } from './routes/expense-settlement.js'
import { importsRoutes } from './routes/imports.js'
import { categoriesRoutes } from './routes/categories.js'
import { expenseTypesRoutes } from './routes/expense-types.js'
import { monthlyLimitsRoutes } from './routes/monthly-limits.js'
import { classificationRoutes } from './routes/classification.js'
import { onboardingRoutes } from './routes/onboarding.js'
import { gmailOAuthRoutes } from './routes/gmail-oauth.js'
import { lineWebhookRoutes } from './routes/line-webhook.js'
import { lineAuthMiddleware } from './middleware/line-auth.js'
import { devViewerIdMiddleware } from './middleware/viewer-id.js'
import { createAllowlistGuardMiddleware } from './middleware/allowlist-guard.js'
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

  // 許可オリジンは composition-root が環境変数 CORS_ALLOWED_ORIGINS から解決する
  // （本番の web オリジンは CloudFront のドメインになるためハードコードできない）
  app.use('*', cors({ origin: deps.allowedOrigins }))
  app.use('/api/*', isDev ? devViewerIdMiddleware : lineAuthMiddleware)
  // 閲覧者が確定した直後に許可リストを照合する（#533）。認証は「LINE の正規利用者か」しか
  // 見ないため、これが無いと世帯外のユーザーが API を直接呼んで自分名義のデータを作れる。
  // 環境で有効・無効を切り替えない（dev だけ素通しにすると、素通しの経路がテストされない）。
  app.use('/api/*', createAllowlistGuardMiddleware({ allowlistQuery: deps.allowlistQuery }))
  app.onError(errorHandler)

  app.route('/api/me', meRoutes(deps.resolveViewerRole))
  app.route(
    '/api/onboarding',
    onboardingRoutes({
      appUserRepository: deps.appUserRepository,
      sharedTalkRoomRepository: deps.sharedTalkRoomRepository,
      householdNotificationActivationRepository: deps.householdNotificationActivationRepository,
      accountRepository: deps.accountRepository,
      spouseCompletionQuery: deps.spouseCompletionQuery,
      allowlistQuery: deps.allowlistQuery,
      gmailOAuthGateway: deps.gmailOAuthGateway,
      lineFriendshipGateway: deps.lineFriendshipGateway,
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
  // LINE Webhook は LINE プラットフォームから到達するため LIFF 認証（/api/*）の外に置く
  // （OQ-55 ④）。送信元の真正性は x-line-signature の署名検証だけが担保する
  app.route(
    '/webhook',
    lineWebhookRoutes({
      appUserRepository: deps.appUserRepository,
      sharedTalkRoomRepository: deps.sharedTalkRoomRepository,
      householdNotificationActivationRepository: deps.householdNotificationActivationRepository,
      resolveLineChannelSecret: deps.resolveLineChannelSecret,
      lineTalkRoomMembershipGateway: deps.lineTalkRoomMembershipGateway,
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
      deps.merchantLearningRuleRepository,
    ),
  )
  app.route('/api/monthly-reports', monthlyReportsRoutes(deps.monthlyReportQuery))
  app.route(
    '/api/balances',
    balancesRoutes(deps.accountBalanceQuery, deps.balanceTimeSeriesQuery, deps.accountDetailQuery),
  )
  app.route(
    '/api/bank-deposits',
    bankDepositsRoutes({
      bankDepositRepository: deps.bankDepositRepository,
      employerRemitterDirectoryRepository: deps.employerRemitterDirectoryRepository,
      accountRepository: deps.accountRepository,
      eventBus: deps.eventBus,
    }),
  )
  app.route(
    '/api/accounts',
    accountsRoutes({
      accountRepository: deps.accountRepository,
      mitsuiSumitomoUnpaidRepository: deps.mitsuiSumitomoUnpaidRepository,
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
      gmailOAuthTokenRepository: deps.gmailOAuthTokenRepository,
      gmailMailFetchGateway: deps.gmailMailFetchGateway,
      parseSmbcNotificationMail: deps.parseSmbcNotificationMail,
      parseAmazonOrderConfirmationMail: deps.parseAmazonOrderConfirmationMail,
      transactionRepository: deps.transactionRepository,
      pdfToCsvConverter: deps.pdfToCsvConverter,
      resolveViewerRole: deps.resolveViewerRole,
      eventBus: deps.eventBus,
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
      eventBus: deps.eventBus,
    }),
  )
  app.route(
    '/api/monthly-limits',
    monthlyLimitsRoutes(
      deps.monthlyLimitRepository,
      deps.expenseTypeMasterRepository,
      deps.eventBus,
    ),
  )
  app.route(
    '/api/classification',
    classificationRoutes({
      retroactiveCandidateQuery: deps.retroactiveCandidateQuery,
      merchantLearningRuleRepository: deps.merchantLearningRuleRepository,
      bulkClassificationSessionRepository: deps.bulkClassificationSessionRepository,
      transactionRepository: deps.transactionRepository,
      resolveViewerRole: deps.resolveViewerRole,
      eventBus: deps.eventBus,
    }),
  )

  app.get('/health', c => c.json({ ok: true }))

  return app
}
