import type {
  AccountBalanceQuery,
  AllowlistQuery,
  AmazonProductKeyLearningRuleRepository,
  AppUserRepository,
  BalanceTimeSeriesQuery,
  BulkClassificationSessionRepository,
  CategoryDeletionRequestRepository,
  CategoryMasterRepository,
  CsvImportStatusQuery,
  DailyMailImportBatchRepository,
  DashboardQuery,
  EventBus,
  ExpenseReimbursementDepositRepository,
  ExpenseSettlementManagementQuery,
  ExpenseTypeDeletionRequestRepository,
  ExpenseTypeMasterRepository,
  GmailOAuthGateway,
  GmailOAuthTokenRepository,
  MerchantLearningRuleRepository,
  MonthlyExpenseCycleRepository,
  MonthlyLimitRepository,
  MonthlyReportQuery,
  MonthlyReportRepository,
  PdfToCsvConverter,
  ProratedChildTransactionRepository,
  RetroactiveCandidateQuery,
  SpouseCompletionQuery,
  StatementImportJobRepository,
  TransactionCandidateRepository,
  TransactionListQuery,
  TransactionRepository,
  UserId,
  UserRole,
} from '@warimaru/domain'
import { AllowlistSchema, InMemoryEventBus } from '@warimaru/domain'
import {
  createNeonHttpDb,
  NeonAllowlistQuery,
  NeonAppUserRepository,
  NeonGmailOAuthTokenRepository,
  NeonSpouseCompletionQuery,
  NeonAmazonProductKeyLearningRuleRepository,
  NeonBulkClassificationSessionRepository,
  NeonCategoryDeletionRequestRepository,
  NeonCategoryMasterRepository,
  NeonDashboardQuery,
  NeonDailyMailImportBatchRepository,
  NeonExpenseReimbursementDepositRepository,
  NeonExpenseTypeDeletionRequestRepository,
  NeonExpenseTypeMasterRepository,
  NeonMerchantLearningRuleRepository,
  NeonMonthlyExpenseCycleRepository,
  NeonMonthlyLimitRepository,
  NeonMonthlyReportRepository,
  NeonProratedChildTransactionRepository,
  NeonRetroactiveCandidateQuery,
  NeonStatementImportJobRepository,
  NeonTransactionCandidateRepository,
  NeonTransactionListQuery,
  NeonTransactionRepository,
  NeonMonthlyReportQuery,
  NeonAccountBalanceQuery,
  NeonBalanceTimeSeriesQuery,
  NeonExpenseSettlementManagementQuery,
  NeonCsvImportStatusQuery,
  createDbResolveCategoryNames,
  createDbResolveViewerRole,
} from '@warimaru/adapters-neon'
import { AnthropicPdfToCsvConverter } from './pdf-conversion/AnthropicPdfToCsvConverter.js'
import { createGmailOAuthStateCodec } from './gmail-oauth/state.js'
import { GoogleGmailOAuthGateway } from './gmail-oauth/GoogleGmailOAuthGateway.js'
import {
  createMockGmailOAuthGateway,
  createUnconfiguredGmailOAuthGateway,
} from './gmail-oauth/mock.js'
import {
  createSsmParameterStore,
  createUnconfiguredParameterStore,
} from './aws/ssm-parameter-store.js'
import { createMockDashboardQuery } from './mock-dashboard-query.js'
import {
  createMockTransactionListQuery,
  createMockMonthlyReportQuery,
  createMockAccountBalanceQuery,
  createMockBalanceTimeSeriesQuery,
  createMockExpenseSettlementManagementQuery,
  createMockCsvImportStatusQuery,
  createMockAllowlistQuery,
  createMockSpouseCompletionQuery,
} from './mock-queries.js'
import {
  createMockAppUserRepository,
  createMockGmailOAuthTokenRepository,
  createMockAmazonProductKeyLearningRuleRepository,
  createMockPdfToCsvConverter,
  createMockBulkClassificationSessionRepository,
  createMockCategoryDeletionRequestRepository,
  createMockCategoryMasterRepository,
  createMockDailyMailImportBatchRepository,
  createMockExpenseReimbursementDepositRepository,
  createMockExpenseTypeDeletionRequestRepository,
  createMockExpenseTypeMasterRepository,
  createMockMerchantLearningRuleRepository,
  createMockMonthlyExpenseCycleRepository,
  createMockMonthlyLimitRepository,
  createMockMonthlyReportRepository,
  createMockProratedChildTransactionRepository,
  createMockRetroactiveCandidateQuery,
  createMockStatementImportJobRepository,
  createMockTransactionCandidateRepository,
  createMockTransactionRepository,
} from './mock-repositories.js'

export interface AppDeps {
  // ドメインイベントバス (#34): 同期・インプロセス配信。ハンドラー登録は createApp が行う
  eventBus: EventBus
  dashboardQuery: DashboardQuery
  transactionListQuery: TransactionListQuery
  monthlyReportQuery: MonthlyReportQuery
  accountBalanceQuery: AccountBalanceQuery
  balanceTimeSeriesQuery: BalanceTimeSeriesQuery
  expenseSettlementManagementQuery: ExpenseSettlementManagementQuery
  csvImportStatusQuery: CsvImportStatusQuery
  resolveViewerRole: (viewerId: UserId) => Promise<UserRole>
  // マスタデータ (#21)
  categoryMasterRepository: CategoryMasterRepository
  expenseTypeMasterRepository: ExpenseTypeMasterRepository
  monthlyLimitRepository: MonthlyLimitRepository
  categoryDeletionRequestRepository: CategoryDeletionRequestRepository
  expenseTypeDeletionRequestRepository: ExpenseTypeDeletionRequestRepository
  // 取引コマンド (#22)
  transactionRepository: TransactionRepository
  // 取引取込 (#23)
  statementImportJobRepository: StatementImportJobRepository
  transactionCandidateRepository: TransactionCandidateRepository
  dailyMailImportBatchRepository: DailyMailImportBatchRepository
  // PDF→CSV 変換 (#33): ANTHROPIC_API_KEY は adapter が呼び出し時に環境から解決する
  pdfToCsvConverter: PdfToCsvConverter
  // 自動分類 (#24)
  retroactiveCandidateQuery: RetroactiveCandidateQuery
  merchantLearningRuleRepository: MerchantLearningRuleRepository
  amazonProductKeyLearningRuleRepository: AmazonProductKeyLearningRuleRepository
  bulkClassificationSessionRepository: BulkClassificationSessionRepository
  // 経費精算 (#25)
  monthlyExpenseCycleRepository: MonthlyExpenseCycleRepository
  proratedChildTransactionRepository: ProratedChildTransactionRepository
  expenseReimbursementDepositRepository: ExpenseReimbursementDepositRepository
  // 家計分析 (#43): サイクル確定 → 月次レポート最終確定ハンドラーが使用
  monthlyReportRepository: MonthlyReportRepository
  // オンボーディング・認証 (#41)
  appUserRepository: AppUserRepository
  gmailOAuthTokenRepository: GmailOAuthTokenRepository
  spouseCompletionQuery: SpouseCompletionQuery
  allowlistQuery: AllowlistQuery
  gmailOAuthGateway: GmailOAuthGateway
}

export interface CompositionEnv {
  DATABASE_URL?: string | undefined
  // Gmail OAuth (#41)。未設定なら実 DB モードでも Gmail 連携のみ未構成エラーになる
  GOOGLE_OAUTH_CLIENT_ID?: string | undefined
  GOOGLE_OAUTH_CLIENT_SECRET?: string | undefined
  GOOGLE_OAUTH_REDIRECT_URI?: string | undefined
  /** state 署名鍵。未設定なら GOOGLE_OAUTH_CLIENT_SECRET を流用 */
  GMAIL_OAUTH_STATE_SECRET?: string | undefined
  /** Parameter Store（許可リスト読出し / トークン保管）の有効化判定 */
  AWS_REGION?: string | undefined
}

export function createDeps(env: CompositionEnv): AppDeps {
  if (!env.DATABASE_URL) {
    console.warn('DATABASE_URL not set — using mock data')
    // 開発モードの許可リスト（devViewerIdMiddleware / テストの X-User-Id と揃える）
    const devAllowlist = AllowlistSchema.parse({
      honeyLineUserId: 'user-honey-test',
      darlingLineUserId: 'user-darling-test',
    })
    const appUserRepository = createMockAppUserRepository()
    return {
      appUserRepository,
      gmailOAuthTokenRepository: createMockGmailOAuthTokenRepository(),
      allowlistQuery: createMockAllowlistQuery(devAllowlist),
      spouseCompletionQuery: createMockSpouseCompletionQuery(appUserRepository, devAllowlist),
      gmailOAuthGateway: createMockGmailOAuthGateway(
        createGmailOAuthStateCodec(env.GMAIL_OAUTH_STATE_SECRET ?? 'dev-state-secret'),
      ),
      eventBus: new InMemoryEventBus(),
      dashboardQuery: createMockDashboardQuery(),
      transactionListQuery: createMockTransactionListQuery(),
      monthlyReportQuery: createMockMonthlyReportQuery(),
      accountBalanceQuery: createMockAccountBalanceQuery(),
      balanceTimeSeriesQuery: createMockBalanceTimeSeriesQuery(),
      expenseSettlementManagementQuery: createMockExpenseSettlementManagementQuery(),
      csvImportStatusQuery: createMockCsvImportStatusQuery(),
      // 開発モードの簡易ロール判定（seed の U_HONEY_DEV やテストの user-honey-test を honey に解決する）
      resolveViewerRole: (viewerId: UserId) =>
        Promise.resolve(
          viewerId.toLowerCase().includes('honey') ? ('honey' as const) : ('darling' as const),
        ),
      categoryMasterRepository: createMockCategoryMasterRepository(),
      expenseTypeMasterRepository: createMockExpenseTypeMasterRepository(),
      monthlyLimitRepository: createMockMonthlyLimitRepository(),
      categoryDeletionRequestRepository: createMockCategoryDeletionRequestRepository(),
      expenseTypeDeletionRequestRepository: createMockExpenseTypeDeletionRequestRepository(),
      transactionRepository: createMockTransactionRepository(),
      statementImportJobRepository: createMockStatementImportJobRepository(),
      transactionCandidateRepository: createMockTransactionCandidateRepository(),
      dailyMailImportBatchRepository: createMockDailyMailImportBatchRepository(),
      pdfToCsvConverter: createMockPdfToCsvConverter(),
      retroactiveCandidateQuery: createMockRetroactiveCandidateQuery(),
      merchantLearningRuleRepository: createMockMerchantLearningRuleRepository(),
      amazonProductKeyLearningRuleRepository: createMockAmazonProductKeyLearningRuleRepository(),
      bulkClassificationSessionRepository: createMockBulkClassificationSessionRepository(),
      monthlyExpenseCycleRepository: createMockMonthlyExpenseCycleRepository(),
      proratedChildTransactionRepository: createMockProratedChildTransactionRepository(),
      expenseReimbursementDepositRepository: createMockExpenseReimbursementDepositRepository(),
      monthlyReportRepository: createMockMonthlyReportRepository(),
    }
  }

  const db = createNeonHttpDb(env.DATABASE_URL)
  const resolveCategoryNames = createDbResolveCategoryNames(db)
  const resolveViewerRole = createDbResolveViewerRole(db)
  const now = (): Date => new Date()

  // Parameter Store（許可リストの実値解決 / Gmail トークン保管）。AWS 未構成なら呼出し時に明示エラー
  const parameterStore = env.AWS_REGION
    ? createSsmParameterStore()
    : createUnconfiguredParameterStore()
  const allowlistQuery = new NeonAllowlistQuery(db, {
    resolveParameterStoreValue: path => parameterStore.read(path),
  })
  const gmailOAuthGateway =
    env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_OAUTH_REDIRECT_URI
      ? new GoogleGmailOAuthGateway(
          {
            clientId: env.GOOGLE_OAUTH_CLIENT_ID,
            clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
            redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
          },
          {
            stateCodec: createGmailOAuthStateCodec(
              env.GMAIL_OAUTH_STATE_SECRET ?? env.GOOGLE_OAUTH_CLIENT_SECRET,
            ),
            storeSecret: (path, value) => parameterStore.write(path, value),
          },
        )
      : createUnconfiguredGmailOAuthGateway()

  return {
    eventBus: new InMemoryEventBus(),
    appUserRepository: new NeonAppUserRepository(db),
    gmailOAuthTokenRepository: new NeonGmailOAuthTokenRepository(db),
    allowlistQuery,
    spouseCompletionQuery: new NeonSpouseCompletionQuery(db, {
      fetchAllowlist: () => allowlistQuery.fetch(),
      now,
    }),
    gmailOAuthGateway,
    dashboardQuery: new NeonDashboardQuery(db, { resolveCategoryNames, resolveViewerRole }),
    transactionListQuery: new NeonTransactionListQuery(db, {
      resolveCategoryNames,
      resolveViewerRole,
    }),
    monthlyReportQuery: new NeonMonthlyReportQuery(db),
    accountBalanceQuery: new NeonAccountBalanceQuery(db, { now }),
    balanceTimeSeriesQuery: new NeonBalanceTimeSeriesQuery(db),
    expenseSettlementManagementQuery: new NeonExpenseSettlementManagementQuery(db, { now }),
    csvImportStatusQuery: new NeonCsvImportStatusQuery(db),
    resolveViewerRole,
    categoryMasterRepository: new NeonCategoryMasterRepository(db),
    expenseTypeMasterRepository: new NeonExpenseTypeMasterRepository(db),
    monthlyLimitRepository: new NeonMonthlyLimitRepository(db),
    categoryDeletionRequestRepository: new NeonCategoryDeletionRequestRepository(db),
    expenseTypeDeletionRequestRepository: new NeonExpenseTypeDeletionRequestRepository(db),
    transactionRepository: new NeonTransactionRepository(db),
    statementImportJobRepository: new NeonStatementImportJobRepository(db),
    transactionCandidateRepository: new NeonTransactionCandidateRepository(db),
    dailyMailImportBatchRepository: new NeonDailyMailImportBatchRepository(db),
    pdfToCsvConverter: new AnthropicPdfToCsvConverter(),
    retroactiveCandidateQuery: new NeonRetroactiveCandidateQuery(db, { now }),
    merchantLearningRuleRepository: new NeonMerchantLearningRuleRepository(db),
    amazonProductKeyLearningRuleRepository: new NeonAmazonProductKeyLearningRuleRepository(db),
    bulkClassificationSessionRepository: new NeonBulkClassificationSessionRepository(db),
    monthlyExpenseCycleRepository: new NeonMonthlyExpenseCycleRepository(db),
    proratedChildTransactionRepository: new NeonProratedChildTransactionRepository(db),
    expenseReimbursementDepositRepository: new NeonExpenseReimbursementDepositRepository(db),
    monthlyReportRepository: new NeonMonthlyReportRepository(db),
  }
}
