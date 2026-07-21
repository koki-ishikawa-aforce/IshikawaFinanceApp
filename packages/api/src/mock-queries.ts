import {
  AccountBalanceListViewSchema,
  AssetTotalViewSchema,
  BalanceTimeSeriesViewSchema,
  ExpenseSettlementManagementViewSchema,
} from '@warimaru/domain'
import type {
  AccountBalanceQuery,
  BalanceTimeSeriesQuery,
  CsvImportStatusQuery,
  ExpenseSettlementManagementQuery,
  MonthlyReportQuery,
  TransactionListQuery,
  UserId,
  YearMonth,
} from '@warimaru/domain'

export function createMockTransactionListQuery(): TransactionListQuery {
  return {
    async fetch() {
      return []
    },
    async fetchUnclassifiedSummary() {
      return { count: 0, recentIds: [] }
    },
  }
}

export function createMockMonthlyReportQuery(): MonthlyReportQuery {
  return {
    async fetchByMonth() {
      return null
    },
    async fetchById() {
      return null
    },
  }
}

export function createMockAccountBalanceQuery(): AccountBalanceQuery {
  return {
    async fetchBalanceList() {
      return AccountBalanceListViewSchema.parse({ items: [] })
    },
    async fetchAssetTotal(asOf: Date) {
      return AssetTotalViewSchema.parse({
        asOf,
        smbcBalance: 0,
        otherSavingsBalance: 0,
        nisaContributionAccumulated: 0,
        cardUnpaidTotal: 0,
        total: 0,
      })
    },
  }
}

export function createMockBalanceTimeSeriesQuery(): BalanceTimeSeriesQuery {
  return {
    async fetch(from: YearMonth, to: YearMonth) {
      return BalanceTimeSeriesViewSchema.parse({
        yearMonthRange: { from, to },
        smbc: [],
        otherSavings: [],
        nisaContribution: [],
        cardUnpaid: [],
      })
    },
  }
}

export function createMockExpenseSettlementManagementQuery(): ExpenseSettlementManagementQuery {
  return {
    async fetch(viewerId: UserId) {
      return ExpenseSettlementManagementViewSchema.parse({
        userId: viewerId,
        currentAccumulations: [],
        currentChildTransactions: [],
        latestFinalizedCycle: null,
      })
    },
  }
}

export function createMockCsvImportStatusQuery(): CsvImportStatusQuery {
  return {
    async fetchCompletion() {
      return null
    },
  }
}
