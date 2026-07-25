import type {
  AccountBalanceQuery,
  AccountRepository,
  AllowlistQuery,
  AmazonProductKeyLearningRuleRepository,
  AppUserRepository,
  BalanceTimeSeriesQuery,
  BulkClassificationSessionRepository,
  CategoryDeletionRequestRepository,
  CategoryMasterRepository,
  ConsecutiveFailureCounterRepository,
  CsvImportStatusQuery,
  DailyMailImportBatchRepository,
  DashboardQuery,
  DeliveryMessageRepository,
  EventBus,
  FailsafeEmailGateway,
  FailsafeEmailRepository,
  ExpenseReimbursementDepositRepository,
  ExpenseSettlementManagementQuery,
  ExpenseTypeDeletionRequestRepository,
  ExpenseTypeMasterRepository,
  GmailOAuthGateway,
  GmailOAuthTokenRepository,
  LineDeliveryLogRepository,
  LineMessagingGateway,
  MerchantLearningRuleRepository,
  MonthlyExpenseCycleRepository,
  MonthlyLimitRepository,
  MonthlyReportQuery,
  MitsuiSumitomoUnpaidRepository,
  MonthlyReportRepository,
  PdfToCsvConverter,
  ProratedChildTransactionRepository,
  RetroactiveCandidateQuery,
  SharedTalkRoomRepository,
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
  createDb,
  NeonAccountRepository,
  NeonAllowlistQuery,
  NeonAppUserRepository,
  NeonGmailOAuthTokenRepository,
  NeonSpouseCompletionQuery,
  NeonAmazonProductKeyLearningRuleRepository,
  NeonBulkClassificationSessionRepository,
  NeonCategoryDeletionRequestRepository,
  NeonCategoryMasterRepository,
  NeonConsecutiveFailureCounterRepository,
  NeonDeliveryMessageRepository,
  NeonFailsafeEmailRepository,
  NeonLineChannelConfigQuery,
  NeonLineDeliveryLogRepository,
  NeonDashboardQuery,
  NeonDailyMailImportBatchRepository,
  NeonExpenseReimbursementDepositRepository,
  NeonExpenseTypeDeletionRequestRepository,
  NeonExpenseTypeMasterRepository,
  NeonMerchantLearningRuleRepository,
  NeonMitsuiSumitomoUnpaidRepository,
  NeonMonthlyExpenseCycleRepository,
  NeonMonthlyLimitRepository,
  NeonMonthlyReportRepository,
  NeonProratedChildTransactionRepository,
  NeonRetroactiveCandidateQuery,
  NeonSharedTalkRoomRepository,
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
import { isProduction } from './env.js'
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
import { createLineMessagingGateway } from './notification/line-messaging-gateway.js'
import {
  createSesFailsafeEmailGateway,
  createUnconfiguredFailsafeEmailGateway,
} from './notification/failsafe-email-gateway.js'
import {
  createMockFailsafeEmailGateway,
  createMockLineMessagingGateway,
} from './notification/mock.js'
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
  createMockAccountRepository,
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
  createMockConsecutiveFailureCounterRepository,
  createMockDeliveryMessageRepository,
  createMockFailsafeEmailRepository,
  createMockLineDeliveryLogRepository,
  createMockMitsuiSumitomoUnpaidRepository,
  createMockMonthlyExpenseCycleRepository,
  createMockMonthlyLimitRepository,
  createMockMonthlyReportRepository,
  createMockProratedChildTransactionRepository,
  createMockRetroactiveCandidateQuery,
  createMockSharedTalkRoomRepository,
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
  // 口座管理 (#48): 設定画面の口座登録・銀行名/証券会社名変更
  accountRepository: AccountRepository
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
  // 残高資産推移 (#69): 未払金計上・消込ハンドラーが使用
  mitsuiSumitomoUnpaidRepository: MitsuiSumitomoUnpaidRepository
  // オンボーディング・認証 (#41)
  appUserRepository: AppUserRepository
  gmailOAuthTokenRepository: GmailOAuthTokenRepository
  /** 共通トークルーム参加は世帯にひとつの事実（OQ-55 ①）。per-user の集約とは別に保持する */
  sharedTalkRoomRepository: SharedTalkRoomRepository
  spouseCompletionQuery: SpouseCompletionQuery
  allowlistQuery: AllowlistQuery
  gmailOAuthGateway: GmailOAuthGateway
  /**
   * LINE Webhook 署名検証鍵の解決（#296、OQ-55 ④）。
   * 環境変数 LINE_CHANNEL_SECRET を優先し、未設定なら Phase0Config の保管参照
   * （lineChannel.channelSecretRef）→ Parameter Store 復号で毎回解決する
   * （Channel Access Token と同じ経路。鍵の実体をプロセスに保持しない）。
   */
  resolveLineChannelSecret: () => Promise<string>
  // 通知配信 (#36): NotificationDeliveryService は createApp が本 deps から組み立てる
  deliveryMessageRepository: DeliveryMessageRepository
  lineDeliveryLogRepository: LineDeliveryLogRepository
  failsafeEmailRepository: FailsafeEmailRepository
  consecutiveFailureCounterRepository: ConsecutiveFailureCounterRepository
  lineMessagingGateway: LineMessagingGateway
  failsafeEmailGateway: FailsafeEmailGateway
  /** フェイルセーフメールの宛先（FAILSAFE_EMAIL_TO、カンマ区切り。未設定なら発火を保留） */
  failsafeEmailRecipients: string[]
  /** フェイルセーフ発火しきい値（FAILSAFE_FAILURE_THRESHOLD。省略時はドメイン既定値） */
  failsafeFailureThreshold?: number | undefined
  /** CORS 許可オリジン（CORS_ALLOWED_ORIGINS、カンマ区切り。開発環境の既定は localhost:3000） */
  allowedOrigins: string[]
}

export interface CompositionEnv {
  DATABASE_URL?: string | undefined
  /**
   * 実行環境。'production' の場合は DATABASE_URL 未設定でのモックフォールバックを禁止し、
   * 起動エラーとする（本番で環境変数の設定漏れがモックデータの黙認になるのを防ぐ）。
   * 未設定・その他の値は開発環境扱い（#14 の DEFAULT_USER_ID フォールバックと同じ方針）。
   */
  NODE_ENV?: string | undefined
  /**
   * DB ドライバの明示指定（'neon-http' / 'node-postgres'）。
   * 未設定なら DATABASE_URL のホストから判定する（Neon なら neon-http、それ以外は node-postgres）。
   * 本番は常に neon-http のため、この指定は開発環境でのみ意味を持つ (#323)。
   */
  DATABASE_DRIVER?: string | undefined
  // Gmail OAuth (#41)。未設定なら実 DB モードでも Gmail 連携のみ未構成エラーになる
  GOOGLE_OAUTH_CLIENT_ID?: string | undefined
  GOOGLE_OAUTH_CLIENT_SECRET?: string | undefined
  GOOGLE_OAUTH_REDIRECT_URI?: string | undefined
  /** state 署名鍵。未設定なら GOOGLE_OAUTH_CLIENT_SECRET を流用 */
  GMAIL_OAUTH_STATE_SECRET?: string | undefined
  /**
   * LINE Webhook 署名検証鍵（#296、OQ-55 ④）。ローカル開発用の指定手段。
   * 未設定なら Phase0Config の保管参照 → Parameter Store から解決する（本番の経路）。
   */
  LINE_CHANNEL_SECRET?: string | undefined
  /** Parameter Store（許可リスト読出し / トークン保管）の有効化判定 */
  AWS_REGION?: string | undefined
  // フェイルセーフメール (#36)。未設定なら発火を保留 / 送信時に明示エラー
  FAILSAFE_EMAIL_FROM?: string | undefined
  /** カンマ区切りの宛先（夫婦各自の登録メールアドレス） */
  FAILSAFE_EMAIL_TO?: string | undefined
  /** フェイルセーフ発火しきい値（省略時はドメイン既定値 = 3） */
  FAILSAFE_FAILURE_THRESHOLD?: string | undefined
  /**
   * CORS 許可オリジン（カンマ区切り）。本番の web オリジン（CloudFront のドメイン等）を指定する。
   * 本番では未設定を致命的な設定漏れとして扱い起動エラーにする（DATABASE_URL と同じ方針）。
   * 開発環境で未設定の場合のみ localhost:3000 を既定とする。
   */
  CORS_ALLOWED_ORIGINS?: string | undefined
}

/** FAILSAFE_EMAIL_TO（カンマ区切り）→ 宛先リスト */
function parseFailsafeRecipients(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

/** FAILSAFE_FAILURE_THRESHOLD → 正の整数（不正値は undefined = ドメイン既定値） */
function parseFailsafeThreshold(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

/** 開発環境で CORS_ALLOWED_ORIGINS が未設定のときの既定（web の `next dev` のオリジン） */
const DEV_ALLOWED_ORIGIN = 'http://localhost:3000'

/**
 * CORS_ALLOWED_ORIGINS（カンマ区切り）→ 許可オリジンのリスト。
 *
 * 本番で未設定なら起動エラーにする。本番の web は CloudFront のドメインから配信されるため、
 * localhost の既定値に黙ってフォールバックすると LIFF 画面からの API 呼び出しが
 * すべてプリフライトで拒否され、原因の分かりにくい全面障害になる。
 */
function resolveAllowedOrigins(env: CompositionEnv): string[] {
  const configured = (env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0)
  if (configured.length > 0) return configured

  if (isProduction(env.NODE_ENV)) {
    throw new Error(
      'CORS_ALLOWED_ORIGINS is required in production. Refusing to start with the localhost default — set the web origin (e.g. https://xxxx.cloudfront.net).',
    )
  }
  return [DEV_ALLOWED_ORIGIN]
}

export function createDeps(env: CompositionEnv): AppDeps {
  if (!env.DATABASE_URL) {
    // 本番では DATABASE_URL 未設定を致命的な設定漏れとして扱い、モックへ黙ってフォールバックしない。
    // モックフォールバックは開発環境専用（#47 / #14 と同じ方針）。
    if (isProduction(env.NODE_ENV)) {
      throw new Error(
        'DATABASE_URL is required in production. Refusing to start with mock data — set DATABASE_URL.',
      )
    }
    console.warn('DATABASE_URL not set — using mock data (development only)')
    // 開発モードの許可リスト（devViewerIdMiddleware / テストの X-User-Id と揃える）
    const devAllowlist = AllowlistSchema.parse({
      honeyLineUserId: 'user-honey-test',
      darlingLineUserId: 'user-darling-test',
    })
    const appUserRepository = createMockAppUserRepository()
    return {
      appUserRepository,
      gmailOAuthTokenRepository: createMockGmailOAuthTokenRepository(),
      sharedTalkRoomRepository: createMockSharedTalkRoomRepository(),
      allowlistQuery: createMockAllowlistQuery(devAllowlist),
      spouseCompletionQuery: createMockSpouseCompletionQuery(appUserRepository, devAllowlist),
      gmailOAuthGateway: createMockGmailOAuthGateway(
        createGmailOAuthStateCodec(env.GMAIL_OAUTH_STATE_SECRET ?? 'dev-state-secret'),
      ),
      // 開発モードは Phase0Config も Parameter Store も無いため、環境変数か固定値で署名検証を通す
      // （この分岐自体が本番では起動エラーになるため、固定値は開発環境に閉じている）
      resolveLineChannelSecret: () =>
        Promise.resolve(env.LINE_CHANNEL_SECRET ?? 'dev-line-channel-secret'),
      eventBus: new InMemoryEventBus(),
      dashboardQuery: createMockDashboardQuery(),
      transactionListQuery: createMockTransactionListQuery(),
      monthlyReportQuery: createMockMonthlyReportQuery(),
      accountBalanceQuery: createMockAccountBalanceQuery(),
      balanceTimeSeriesQuery: createMockBalanceTimeSeriesQuery(),
      accountRepository: createMockAccountRepository(),
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
      mitsuiSumitomoUnpaidRepository: createMockMitsuiSumitomoUnpaidRepository(),
      deliveryMessageRepository: createMockDeliveryMessageRepository(),
      lineDeliveryLogRepository: createMockLineDeliveryLogRepository(),
      failsafeEmailRepository: createMockFailsafeEmailRepository(),
      consecutiveFailureCounterRepository: createMockConsecutiveFailureCounterRepository(),
      lineMessagingGateway: createMockLineMessagingGateway(),
      failsafeEmailGateway: createMockFailsafeEmailGateway(),
      failsafeEmailRecipients: parseFailsafeRecipients(env.FAILSAFE_EMAIL_TO),
      failsafeFailureThreshold: parseFailsafeThreshold(env.FAILSAFE_FAILURE_THRESHOLD),
      allowedOrigins: resolveAllowedOrigins(env),
    }
  }

  // 設定の検証は DB クライアント等を組み立てる前に済ませる（本番の設定漏れは即起動エラー）
  const allowedOrigins = resolveAllowedOrigins(env)

  // 接続先に応じて neon-http（本番の Neon）/ node-postgres（ローカルの素の PostgreSQL）を選ぶ (#323)
  const db = createDb({
    databaseUrl: env.DATABASE_URL,
    isProduction: isProduction(env.NODE_ENV),
    driverOverride: env.DATABASE_DRIVER,
  })
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

  // LINE Channel Access Token はマスタ管理（Phase0Config）の保管参照 → Parameter Store 復号
  // で毎回解決する（08g「LINE Channel設定値を取得する」。未投入・AWS 未構成は送信失敗に翻訳される）
  const lineChannelConfigQuery = new NeonLineChannelConfigQuery(db)
  // Webhook 署名検証鍵も同じ経路（Phase0Config の保管参照 → Parameter Store 復号）で毎回解決する。
  // ローカル開発は Phase0Config を投入せずに動かせるよう LINE_CHANNEL_SECRET を優先する（OQ-55 ④）。
  // 本番でこの抜け道を許すと、鍵の実体がタスク定義に常駐し Parameter Store 側のローテーションにも
  // 追従できなくなるため、環境変数の採用は開発環境に限る（Channel Access Token に抜け道が無いのと揃える）
  const lineChannelSecretFromEnv = isProduction(env.NODE_ENV) ? undefined : env.LINE_CHANNEL_SECRET
  const resolveLineChannelSecret = lineChannelSecretFromEnv
    ? (): Promise<string> => Promise.resolve(lineChannelSecretFromEnv)
    : async (): Promise<string> => {
        const config = await lineChannelConfigQuery.fetch()
        return parameterStore.read(config.channelSecretRef)
      }
  const lineMessagingGateway = createLineMessagingGateway({
    resolveChannelAccessToken: async () => {
      const config = await lineChannelConfigQuery.fetch()
      return parameterStore.read(config.channelAccessTokenRef)
    },
  })
  // 送信ゲートウェイ未構成なら宛先も空にして発火自体を保留する（発火は 1 回だけ = OQ-14 のため、
  // 必ず失敗する送信で唯一の発火を消費しない。構成後の後続失敗で改めて発火する）
  const failsafeConfigured = Boolean(env.AWS_REGION && env.FAILSAFE_EMAIL_FROM)
  const failsafeEmailGateway =
    failsafeConfigured && env.FAILSAFE_EMAIL_FROM
      ? createSesFailsafeEmailGateway({ fromAddress: env.FAILSAFE_EMAIL_FROM })
      : createUnconfiguredFailsafeEmailGateway()
  const failsafeEmailRecipients = failsafeConfigured
    ? parseFailsafeRecipients(env.FAILSAFE_EMAIL_TO)
    : []
  if (!failsafeConfigured && parseFailsafeRecipients(env.FAILSAFE_EMAIL_TO).length > 0) {
    console.warn(
      'FAILSAFE_EMAIL_TO は設定されているが送信ゲートウェイが未構成（AWS_REGION / FAILSAFE_EMAIL_FROM を設定する）— フェイルセーフ発火を保留する',
    )
  }

  return {
    eventBus: new InMemoryEventBus(),
    appUserRepository: new NeonAppUserRepository(db),
    gmailOAuthTokenRepository: new NeonGmailOAuthTokenRepository(db),
    sharedTalkRoomRepository: new NeonSharedTalkRoomRepository(db),
    allowlistQuery,
    spouseCompletionQuery: new NeonSpouseCompletionQuery(db, {
      fetchAllowlist: () => allowlistQuery.fetch(),
      now,
    }),
    gmailOAuthGateway,
    resolveLineChannelSecret,
    dashboardQuery: new NeonDashboardQuery(db, { resolveCategoryNames, resolveViewerRole }),
    transactionListQuery: new NeonTransactionListQuery(db, {
      resolveCategoryNames,
      resolveViewerRole,
    }),
    monthlyReportQuery: new NeonMonthlyReportQuery(db, { resolveViewerRole }),
    accountBalanceQuery: new NeonAccountBalanceQuery(db, { now }),
    balanceTimeSeriesQuery: new NeonBalanceTimeSeriesQuery(db),
    accountRepository: new NeonAccountRepository(db),
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
    mitsuiSumitomoUnpaidRepository: new NeonMitsuiSumitomoUnpaidRepository(db),
    deliveryMessageRepository: new NeonDeliveryMessageRepository(db),
    lineDeliveryLogRepository: new NeonLineDeliveryLogRepository(db),
    failsafeEmailRepository: new NeonFailsafeEmailRepository(db),
    consecutiveFailureCounterRepository: new NeonConsecutiveFailureCounterRepository(db),
    lineMessagingGateway,
    failsafeEmailGateway,
    failsafeEmailRecipients,
    failsafeFailureThreshold: parseFailsafeThreshold(env.FAILSAFE_FAILURE_THRESHOLD),
    allowedOrigins,
  }
}
