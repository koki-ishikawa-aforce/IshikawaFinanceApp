import {
  AccountBalanceListViewSchema,
  InvariantViolationError,
  SpouseCompletionResultSchema,
  AssetTotalViewSchema,
  BalanceTimeSeriesViewSchema,
  ExpenseSettlementManagementViewSchema,
} from '@warimaru/domain'
import type {
  AccountBalanceQuery,
  Allowlist,
  AllowlistQuery,
  AppUser,
  AppUserRepository,
  SpouseCompletionQuery,
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

export function createMockAllowlistQuery(allowlist: Allowlist): AllowlistQuery {
  return {
    async fetch() {
      return allowlist
    },
  }
}

/**
 * SpouseCompletionQuery のインメモリ実装（NeonSpouseCompletionQuery と同じ判定規約）。
 * 「完了」= Phase2 完了以降。両者完了なら both_completed（遅い方の phase2CompletedAt）、
 * そうでなければ awaiting_spouse（配偶者行が未登録なら許可リストで補完）。
 */
export function createMockSpouseCompletionQuery(
  appUserRepository: AppUserRepository,
  allowlist: Allowlist,
): SpouseCompletionQuery {
  type CompletedUser = Extract<AppUser, { kind: 'phase2_completed' | 'operation_started' }>
  const asCompleted = (user: AppUser | undefined): CompletedUser | null =>
    user !== undefined && (user.kind === 'phase2_completed' || user.kind === 'operation_started')
      ? user
      : null
  return {
    async check(viewerId) {
      const users = [
        await appUserRepository.findByRole('honey'),
        await appUserRepository.findByRole('darling'),
      ].filter((u): u is AppUser => u !== null)
      const viewer = users.find(u => u.common.userId === viewerId)
      const spouse = users.find(u => u.common.userId !== viewerId)

      const viewerCompleted = asCompleted(viewer)
      const spouseCompleted = asCompleted(spouse)
      if (viewerCompleted !== null && spouseCompleted !== null) {
        const [honey, darling] =
          viewerCompleted.common.role === 'honey'
            ? [viewerCompleted, spouseCompleted]
            : [spouseCompleted, viewerCompleted]
        return SpouseCompletionResultSchema.parse({
          kind: 'both_completed',
          honeyUserId: honey.common.userId,
          darlingUserId: darling.common.userId,
          bothCompletedAt: new Date(
            Math.max(
              viewerCompleted.phase2CompletedAt.getTime(),
              spouseCompleted.phase2CompletedAt.getTime(),
            ),
          ),
        })
      }

      const spouseUserId =
        spouse?.common.userId ??
        (allowlist.honeyLineUserId === viewerId
          ? allowlist.darlingLineUserId
          : allowlist.darlingLineUserId === viewerId
            ? allowlist.honeyLineUserId
            : null)
      if (spouseUserId === null) {
        throw new InvariantViolationError(`viewer ${viewerId} は許可リストに含まれていない`)
      }
      return SpouseCompletionResultSchema.parse({
        kind: 'awaiting_spouse',
        userId: viewerId,
        spouseUserId,
        detectedAt: new Date(),
      })
    },
  }
}
