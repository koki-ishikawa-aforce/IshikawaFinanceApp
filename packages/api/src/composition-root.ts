import type {
  AccountBalanceQuery,
  AmazonProductKeyLearningRuleRepository,
  BalanceTimeSeriesQuery,
  BulkClassificationSessionRepository,
  CategoryDeletionRequestRepository,
  CategoryMasterRepository,
  CsvImportStatusQuery,
  DailyMailImportBatchRepository,
  DashboardQuery,
  ExpenseReimbursementDepositRepository,
  ExpenseSettlementManagementQuery,
  ExpenseTypeDeletionRequestRepository,
  ExpenseTypeMasterRepository,
  MerchantLearningRuleRepository,
  MonthlyExpenseCycleRepository,
  MonthlyLimitRepository,
  MonthlyReportQuery,
  ProratedChildTransactionRepository,
  RetroactiveCandidateQuery,
  StatementImportJobRepository,
  TransactionCandidateRepository,
  TransactionListQuery,
  TransactionRepository,
  UserId,
  UserRole,
} from '@warimaru/domain'
import {
  createNeonHttpDb,
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
import { createMockDashboardQuery } from './mock-dashboard-query.js'
import {
  createMockTransactionListQuery,
  createMockMonthlyReportQuery,
  createMockAccountBalanceQuery,
  createMockBalanceTimeSeriesQuery,
  createMockExpenseSettlementManagementQuery,
  createMockCsvImportStatusQuery,
} from './mock-queries.js'
import {
  createMockAmazonProductKeyLearningRuleRepository,
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
  createMockProratedChildTransactionRepository,
  createMockRetroactiveCandidateQuery,
  createMockStatementImportJobRepository,
  createMockTransactionCandidateRepository,
  createMockTransactionRepository,
} from './mock-repositories.js'

export interface AppDeps {
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
  // 自動分類 (#24)
  retroactiveCandidateQuery: RetroactiveCandidateQuery
  merchantLearningRuleRepository: MerchantLearningRuleRepository
  amazonProductKeyLearningRuleRepository: AmazonProductKeyLearningRuleRepository
  bulkClassificationSessionRepository: BulkClassificationSessionRepository
  // 経費精算 (#25)
  monthlyExpenseCycleRepository: MonthlyExpenseCycleRepository
  proratedChildTransactionRepository: ProratedChildTransactionRepository
  expenseReimbursementDepositRepository: ExpenseReimbursementDepositRepository
}

export function createDeps(env: { DATABASE_URL?: string | undefined }): AppDeps {
  if (!env.DATABASE_URL) {
    console.warn('DATABASE_URL not set — using mock data')
    return {
      dashboardQuery: createMockDashboardQuery(),
      transactionListQuery: createMockTransactionListQuery(),
      monthlyReportQuery: createMockMonthlyReportQuery(),
      accountBalanceQuery: createMockAccountBalanceQuery(),
      balanceTimeSeriesQuery: createMockBalanceTimeSeriesQuery(),
      expenseSettlementManagementQuery: createMockExpenseSettlementManagementQuery(),
      csvImportStatusQuery: createMockCsvImportStatusQuery(),
      resolveViewerRole: () => Promise.resolve('darling' as const),
      categoryMasterRepository: createMockCategoryMasterRepository(),
      expenseTypeMasterRepository: createMockExpenseTypeMasterRepository(),
      monthlyLimitRepository: createMockMonthlyLimitRepository(),
      categoryDeletionRequestRepository: createMockCategoryDeletionRequestRepository(),
      expenseTypeDeletionRequestRepository: createMockExpenseTypeDeletionRequestRepository(),
      transactionRepository: createMockTransactionRepository(),
      statementImportJobRepository: createMockStatementImportJobRepository(),
      transactionCandidateRepository: createMockTransactionCandidateRepository(),
      dailyMailImportBatchRepository: createMockDailyMailImportBatchRepository(),
      retroactiveCandidateQuery: createMockRetroactiveCandidateQuery(),
      merchantLearningRuleRepository: createMockMerchantLearningRuleRepository(),
      amazonProductKeyLearningRuleRepository: createMockAmazonProductKeyLearningRuleRepository(),
      bulkClassificationSessionRepository: createMockBulkClassificationSessionRepository(),
      monthlyExpenseCycleRepository: createMockMonthlyExpenseCycleRepository(),
      proratedChildTransactionRepository: createMockProratedChildTransactionRepository(),
      expenseReimbursementDepositRepository: createMockExpenseReimbursementDepositRepository(),
    }
  }

  const db = createNeonHttpDb(env.DATABASE_URL)
  const resolveCategoryNames = createDbResolveCategoryNames(db)
  const resolveViewerRole = createDbResolveViewerRole(db)
  const now = (): Date => new Date()

  return {
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
    retroactiveCandidateQuery: new NeonRetroactiveCandidateQuery(db, { now }),
    merchantLearningRuleRepository: new NeonMerchantLearningRuleRepository(db),
    amazonProductKeyLearningRuleRepository: new NeonAmazonProductKeyLearningRuleRepository(db),
    bulkClassificationSessionRepository: new NeonBulkClassificationSessionRepository(db),
    monthlyExpenseCycleRepository: new NeonMonthlyExpenseCycleRepository(db),
    proratedChildTransactionRepository: new NeonProratedChildTransactionRepository(db),
    expenseReimbursementDepositRepository: new NeonExpenseReimbursementDepositRepository(db),
  }
}
