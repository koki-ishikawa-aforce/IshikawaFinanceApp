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

/** GET /api/transactions */
export function transactionListFixture(role: UserRole): unknown {
  const isHoney = role === 'honey'
  return [
    {
      transactionId: 'TXN_MOCK_001',
      occurredAt: '2026-07-20T10:00:00.000Z',
      expenseClass: 'household',
      categoryId: '01HQ8ZKJ9M3N4P5Q6R7S8T9VWX',
      categoryName: '住居費',
      merchantName: '東京電力',
      amount: 8500,
      isUnclassified: false,
    },
    {
      transactionId: 'TXN_MOCK_002',
      occurredAt: '2026-07-18T12:30:00.000Z',
      expenseClass: 'household',
      categoryId: '01HQ8ZKJ9M3N4P5Q6R7S8T9VWY',
      categoryName: '食費',
      merchantName: 'イオン',
      amount: 4200,
      isUnclassified: false,
    },
    {
      transactionId: 'TXN_MOCK_003',
      occurredAt: '2026-07-15T09:00:00.000Z',
      expenseClass: 'personal_darling',
      categoryId: null,
      categoryName: null,
      merchantName: isHoney ? null : 'Amazon',
      amount: isHoney ? null : 3980,
      isUnclassified: !isHoney,
    },
  ]
}

/** GET /api/transactions/unclassified-summary */
export function unclassifiedSummaryFixture(): unknown {
  return {
    count: 1,
    recentIds: ['TXN_MOCK_003'],
  }
}

/** GET /api/categories */
export function categoryListFixture(): unknown {
  return {
    items: [
      {
        kind: 'default',
        categoryId: '01HQ8ZKJ9M3N4P5Q6R7S8T9VWX',
        name: '住居費',
        scope: { kind: 'household_shared' },
      },
      {
        kind: 'default',
        categoryId: '01HQ8ZKJ9M3N4P5Q6R7S8T9VWY',
        name: '食費',
        scope: { kind: 'household_shared' },
      },
      {
        kind: 'default',
        categoryId: '01HQ8ZKJ9M3N4P5Q6R7S8T9VWZ',
        name: '娯楽費',
        scope: { kind: 'household_shared' },
      },
      {
        kind: 'custom',
        categoryId: '01HQ8ZKJ9M3N4P5Q6R7S8T9VW0',
        name: 'その他',
        scope: { kind: 'household_shared' },
      },
    ],
  }
}

/** GET /api/expense-types */
export function expenseTypeListFixture(): unknown {
  return {
    items: [
      {
        kind: 'default',
        expenseTypeId: 'ET_MOCK_001',
        name: '交通費',
        scope: { kind: 'household_shared' },
      },
      {
        kind: 'default',
        expenseTypeId: 'ET_MOCK_002',
        name: '書籍代',
        scope: { kind: 'personal', userId: 'U_DARLING_MOCK' },
      },
    ],
  }
}

/** GET /api/balances */
export function accountBalanceListFixture(): unknown {
  return {
    items: [
      {
        kind: 'smbc_bank',
        accountId: 'ACC_MOCK_001',
        displayName: '三井住友銀行',
        currentBalance: 1500000,
        lastUpdatedAt: '2026-07-23T00:00:00.000Z',
      },
      {
        kind: 'mitsui_sumitomo_card',
        accountId: 'ACC_MOCK_002',
        displayName: '三井住友カード',
        currentMonthUnpaidTotal: 120000,
        lastSettledAt: '2026-07-10T00:00:00.000Z',
      },
      {
        kind: 'other_savings',
        accountId: 'ACC_MOCK_003',
        displayName: '楽天銀行',
        currentBalance: 1740000,
        lastUpdatedAt: '2026-07-20T00:00:00.000Z',
        daysSinceLastUpdate: 4,
      },
      {
        kind: 'nisa',
        accountId: 'ACC_MOCK_004',
        displayName: 'SBI証券 NISA',
        currentAccumulated: 1200000,
        lastUpdatedAt: '2026-07-01T00:00:00.000Z',
      },
    ],
  }
}

/** GET /api/balances/total */
export function assetTotalFixture(): unknown {
  return {
    asOf: '2026-07-24T00:00:00.000Z',
    smbcBalance: 1500000,
    otherSavingsBalance: 1740000,
    nisaContributionAccumulated: 1200000,
    cardUnpaidTotal: 120000,
    total: 4320000,
  }
}

/** GET /api/balances/time-series */
export function balanceTimeSeriesFixture(): unknown {
  return {
    yearMonthRange: { from: '2026-01', to: '2026-07' },
    smbc: [
      { date: '2026-01-31T00:00:00.000Z', amount: 1200000 },
      { date: '2026-04-30T00:00:00.000Z', amount: 1350000 },
      { date: '2026-07-23T00:00:00.000Z', amount: 1500000 },
    ],
    otherSavings: [
      { date: '2026-01-31T00:00:00.000Z', amount: 1600000 },
      { date: '2026-04-30T00:00:00.000Z', amount: 1680000 },
      { date: '2026-07-20T00:00:00.000Z', amount: 1740000 },
    ],
    nisaContribution: [
      { date: '2026-01-31T00:00:00.000Z', amount: 900000 },
      { date: '2026-04-30T00:00:00.000Z', amount: 1050000 },
      { date: '2026-07-01T00:00:00.000Z', amount: 1200000 },
    ],
    cardUnpaid: [
      { date: '2026-01-31T00:00:00.000Z', amount: 95000 },
      { date: '2026-04-30T00:00:00.000Z', amount: 110000 },
      { date: '2026-07-10T00:00:00.000Z', amount: 120000 },
    ],
  }
}

/** GET /api/monthly-reports */
export function monthlyReportFixture(yearMonth: string): unknown {
  return {
    status: 'csv_confirmed',
    common: {
      monthlyReportId: 'MR_MOCK_001',
      targetYearMonth: yearMonth,
      householdCategoryTotals: [
        { categoryId: '01HQ8ZKJ9M3N4P5Q6R7S8T9VWX', total: 98000 },
        { categoryId: '01HQ8ZKJ9M3N4P5Q6R7S8T9VWY', total: 72000 },
        { categoryId: '01HQ8ZKJ9M3N4P5Q6R7S8T9VWZ', total: 48000 },
        { categoryId: '01HQ8ZKJ9M3N4P5Q6R7S8T9VW0', total: 30000 },
      ],
      personalTotalHoney: 72000,
      personalTotalDarling: 86000,
      businessExpenseTotalSelf: 15000,
      nisaContributionAccumulated: 1200000,
      balanceTrend: {
        smbcBalanceTrend: [{ date: '2026-07-01T00:00:00.000Z', balance: 1500000 }],
        otherSavingsBalanceTrend: [{ date: '2026-07-01T00:00:00.000Z', balance: 1740000 }],
        nisaContributionTrend: [{ date: '2026-07-01T00:00:00.000Z', accumulated: 1200000 }],
        cardUnpaidTrend: [{ date: '2026-07-01T00:00:00.000Z', unpaidTotal: 120000 }],
      },
      isIncompleteMonth: true,
    },
    csvConfirmedAt: '2026-07-15T10:00:00.000Z',
    finalizedAt: null,
    unapprovedTransfers: null,
  }
}

/** GET /api/settings/profile */
export function settingsProfileFixture(role: UserRole): unknown {
  return {
    profile: {
      userId: role === 'honey' ? 'U_HONEY_MOCK' : 'U_DARLING_MOCK',
      role,
      nickname: role === 'honey' ? 'はにー' : 'だーりん',
    },
  }
}

/** GET /api/accounts */
export function ownAccountListFixture(): unknown {
  return {
    items: [
      {
        kind: 'smbc_bank',
        common: {
          accountId: 'ACC_MOCK_001',
          ownerUserId: 'U_DARLING_MOCK',
          activeness: { kind: 'active' },
        },
        balance: { currentBalance: 1500000 },
      },
      {
        kind: 'mitsui_sumitomo_card',
        common: {
          accountId: 'ACC_MOCK_002',
          ownerUserId: 'U_DARLING_MOCK',
          activeness: { kind: 'active' },
        },
      },
      {
        kind: 'other_savings',
        common: {
          accountId: 'ACC_MOCK_003',
          ownerUserId: 'U_DARLING_MOCK',
          activeness: { kind: 'active' },
        },
        bankName: '楽天銀行',
        balance: { currentBalance: 1740000 },
      },
      {
        kind: 'nisa',
        common: {
          accountId: 'ACC_MOCK_004',
          ownerUserId: 'U_DARLING_MOCK',
          activeness: { kind: 'active' },
        },
        brokerageName: { kind: 'sbi' },
        contribution: { currentAccumulated: 1200000 },
      },
    ],
  }
}

/** GET /api/monthly-limits */
export function monthlyLimitListFixture(): unknown {
  return {
    items: [
      {
        kind: 'capped',
        monthlyLimitId: 'ML_MOCK_001',
        userId: 'U_DARLING_MOCK',
        expenseTypeId: 'ET_MOCK_001',
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        capAmount: 30000,
        changeHistory: [],
      },
      {
        kind: 'unlimited',
        monthlyLimitId: 'ML_MOCK_002',
        userId: 'U_DARLING_MOCK',
        expenseTypeId: 'ET_MOCK_002',
        effectiveFrom: '2026-01-01T00:00:00.000Z',
      },
    ],
  }
}

/** GET /api/onboarding/me */
export function onboardingMeFixture(): unknown {
  return {
    user: {
      kind: 'operation_started',
      common: {
        userId: 'U_DARLING_MOCK',
        role: 'darling',
        nickname: 'だーりん',
        firstRegisteredAt: '2026-01-01T00:00:00.000Z',
        lineOperationSettings: {
          friendAdd: { kind: 'added' },
          notificationActivation: { kind: 'activated' },
        },
      },
      lineOperationSettings: {
        friendAdd: { kind: 'added' },
        notificationActivation: { kind: 'activated' },
      },
    },
    // 共通トークルーム参加は世帯レベルの記録（OQ-55 ①）
    sharedTalkRoom: { kind: 'joined' },
  }
}

/** GET /api/imports/status */
export function importStatusFixture(): unknown {
  return { completion: null }
}
