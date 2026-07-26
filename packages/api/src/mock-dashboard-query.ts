import type {
  BalanceFreshnessListView,
  DashboardQuery,
  DashboardKpisView,
  DashboardMode,
  CategoryBreakdownView,
  UserId,
  YearMonth,
} from '@warimaru/domain'
import {
  BalanceFreshnessListViewSchema,
  DashboardKpisViewSchema,
  CategoryBreakdownViewSchema,
} from '@warimaru/domain'

export function createMockDashboardQuery(): DashboardQuery {
  return {
    async fetchKpis(
      _viewerId: UserId,
      _month: YearMonth,
      mode: DashboardMode,
    ): Promise<DashboardKpisView> {
      return DashboardKpisViewSchema.parse({
        mode,
        currentMonthSpending: 187500,
        spousePersonalTotal: 64000,
        savingsBalance: 2450000,
        nisaContributionAccumulated: 360000,
        totalAssets: 2760000,
      })
    },

    async fetchBalanceFreshness(_viewerId: UserId): Promise<BalanceFreshnessListView> {
      return BalanceFreshnessListViewSchema.parse({
        items: [
          {
            accountId: '01JAAAAAAAAAAAAAAAAAAAAAB1',
            displayName: 'ゆうちょ銀行',
            lastUpdatedAt: new Date('2026-07-20T00:00:00.000Z'),
            daysSinceLastUpdate: 4,
            status: 'ok',
          },
        ],
      })
    },

    async fetchCategoryBreakdown(
      _viewerId: UserId,
      month: YearMonth,
      mode: DashboardMode,
    ): Promise<CategoryBreakdownView> {
      return CategoryBreakdownViewSchema.parse({
        mode,
        yearMonth: month,
        totalAmount: 187500,
        items: [
          {
            categoryId: '01JAAAAAAAAAAAAAAAAAAAAAA1',
            categoryName: '住居光熱通信',
            total: 85000,
            count: 5,
            percentage: 45.3,
          },
          {
            categoryId: '01JAAAAAAAAAAAAAAAAAAAAAA2',
            categoryName: '食費',
            total: 52000,
            count: 18,
            percentage: 27.7,
          },
          {
            categoryId: '01JAAAAAAAAAAAAAAAAAAAAAA3',
            categoryName: '娯楽',
            total: 31500,
            count: 4,
            percentage: 16.8,
          },
          {
            categoryId: '01JAAAAAAAAAAAAAAAAAAAAAA4',
            categoryName: 'その他',
            total: 19000,
            count: 7,
            percentage: 10.1,
          },
        ],
      })
    },
  }
}
