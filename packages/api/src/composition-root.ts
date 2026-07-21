import type {
  AccountBalanceQuery,
  BalanceTimeSeriesQuery,
  CsvImportStatusQuery,
  DashboardQuery,
  ExpenseSettlementManagementQuery,
  MonthlyReportQuery,
  TransactionListQuery,
  UserId,
  UserRole,
} from '@warimaru/domain'
import {
  createNeonHttpDb,
  NeonDashboardQuery,
  NeonTransactionListQuery,
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

export interface AppDeps {
  dashboardQuery: DashboardQuery
  transactionListQuery: TransactionListQuery
  monthlyReportQuery: MonthlyReportQuery
  accountBalanceQuery: AccountBalanceQuery
  balanceTimeSeriesQuery: BalanceTimeSeriesQuery
  expenseSettlementManagementQuery: ExpenseSettlementManagementQuery
  csvImportStatusQuery: CsvImportStatusQuery
  resolveViewerRole: (viewerId: UserId) => Promise<UserRole>
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
      resolveViewerRole: async () => 'darling' as const,
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
  }
}
