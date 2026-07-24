/**
 * モック起動モード（NEXT_PUBLIC_MOCK=1）用の固定 fixture データ。
 *
 * LIFF 認証・実 API なしでダッシュボードを描画するためのワイヤー形式レスポンスを返す。
 * サーバーの JSON 応答をそのまま模しており、呼び出し側（api-client）で
 * 実 API と同じ Zod スキーマ検証を通す。ここにはドメインの不変条件・配色などの
 * 知識は持ち込まない（純粋な表示用サンプル値のみ）。
 */
import type { DashboardMode, UserRole } from '@warimaru/domain'

/** GET /api/me */
export function meFixture(role: UserRole): unknown {
  return {
    viewerId: role === 'honey' ? 'U_HONEY_MOCK' : 'U_DARLING_MOCK',
    role,
  }
}

/** GET /api/dashboard/kpis */
export function dashboardKpisFixture(mode: DashboardMode): unknown {
  if (mode === 'personal') {
    return {
      mode,
      currentMonthSpending: 86000,
      spousePersonalTotal: 72000,
      savingsBalance: 3240000,
      nisaContributionAccumulated: 1200000,
      totalAssets: 4180000,
    }
  }
  return {
    mode,
    currentMonthSpending: 248000,
    spousePersonalTotal: 72000,
    savingsBalance: 3240000,
    nisaContributionAccumulated: 1200000,
    totalAssets: 4180000,
  }
}

/**
 * GET /api/dashboard/category-breakdown
 * 内訳合計は同モードの `dashboardKpisFixture.currentMonthSpending` と一致させる
 * （世帯=248000 / 個人=86000）。スクリーンショット・ビジュアルリグレッションの
 * 土台として、モード切替時のデータ整合を保つため。
 */
export function categoryBreakdownFixture(mode: DashboardMode, yearMonth: string): unknown {
  const items =
    mode === 'personal'
      ? [
          {
            categoryId: '01HQ8ZKJ9M3N4P5Q6R7S8T9VWX',
            categoryName: '食費',
            total: 40000,
            count: 14,
            percentage: 46.5,
          },
          {
            categoryId: '01HQ8ZKJ9M3N4P5Q6R7S8T9VWZ',
            categoryName: '娯楽費',
            total: 26000,
            count: 6,
            percentage: 30.2,
          },
          {
            categoryId: '01HQ8ZKJ9M3N4P5Q6R7S8T9VW0',
            categoryName: 'その他',
            total: 20000,
            count: 5,
            percentage: 23.3,
          },
        ]
      : [
          {
            categoryId: '01HQ8ZKJ9M3N4P5Q6R7S8T9VWX',
            categoryName: '住居費',
            total: 98000,
            count: 3,
            percentage: 39.5,
          },
          {
            categoryId: '01HQ8ZKJ9M3N4P5Q6R7S8T9VWY',
            categoryName: '食費',
            total: 72000,
            count: 24,
            percentage: 29.0,
          },
          {
            categoryId: '01HQ8ZKJ9M3N4P5Q6R7S8T9VWZ',
            categoryName: '娯楽費',
            total: 48000,
            count: 9,
            percentage: 19.4,
          },
          {
            categoryId: '01HQ8ZKJ9M3N4P5Q6R7S8T9VW0',
            categoryName: 'その他',
            total: 30000,
            count: 11,
            percentage: 12.1,
          },
        ]
  return {
    mode,
    yearMonth,
    totalAmount: items.reduce((sum, item) => sum + item.total, 0),
    items,
  }
}
