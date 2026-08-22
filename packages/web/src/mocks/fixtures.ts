/**
 * モック起動モード（NEXT_PUBLIC_MOCK=1）用の固定 fixture データ。
 *
 * LIFF 認証・実 API なしでダッシュボードを描画するためのワイヤー形式レスポンスを返す。
 * サーバーの JSON 応答をそのまま模しており、呼び出し側（api-client）で
 * 実 API と同じ Zod スキーマ検証を通す。ここにはドメインの不変条件・配色などの
 * 知識は持ち込まない（純粋な表示用サンプル値のみ）。
 */
import type { DashboardMode, UserRole } from '@warimaru/domain'
import type { MockScenario } from './scenario'

/**
 * 任意登録の口座（別銀行貯蓄・NISA）が登録済みか。
 * `accounts-unregistered` シナリオでは、これらを持つ fixture から一律に取り除く
 * （設定では未登録なのに残高一覧には出ている、という食い違いを作らないため）。
 */
function hasOptionalAccounts(scenario: MockScenario): boolean {
  return scenario === 'default'
}

/** GET /api/me */
export function meFixture(role: UserRole): unknown {
  return {
    viewerId: role === 'honey' ? 'U_HONEY_MOCK' : 'U_DARLING_MOCK',
    role,
  }
}

/**
 * GET /api/dashboard/kpis
 *
 * 貯蓄・NISA の額は口座の登録状況に従う。`accounts-unregistered` では別銀行貯蓄
 * （楽天銀行 1,740,000）と NISA（1,200,000）を差し引き、三井住友銀行のぶんだけが残る。
 */
export function dashboardKpisFixture(mode: DashboardMode, scenario: MockScenario): unknown {
  const registered = hasOptionalAccounts(scenario)
  const assets = {
    savingsBalance: registered ? 3240000 : 1500000,
    nisaContributionAccumulated: registered ? 1200000 : 0,
    totalAssets: registered ? 4180000 : 1240000,
  }
  if (mode === 'personal') {
    return {
      mode,
      currentMonthSpending: 86000,
      spousePersonalTotal: 72000,
      ...assets,
    }
  }
  return {
    mode,
    currentMonthSpending: 248000,
    spousePersonalTotal: 72000,
    ...assets,
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
    // 未分類の自分の取引。どちらのロールでも「まとめて分類」の導線と
    // 一括分類セッション（加盟店 2 件）が両テーマで確認できるように置く
    {
      transactionId: 'TXN_MOCK_004',
      occurredAt: '2026-07-12T08:20:00.000Z',
      expenseClass: isHoney ? 'personal_honey' : 'personal_darling',
      categoryId: null,
      categoryName: null,
      merchantName: 'ドラッグストアA',
      amount: 1580,
      isUnclassified: true,
    },
    {
      transactionId: 'TXN_MOCK_005',
      occurredAt: '2026-07-08T15:40:00.000Z',
      expenseClass: isHoney ? 'personal_honey' : 'personal_darling',
      categoryId: null,
      categoryName: null,
      merchantName: 'カフェB',
      amount: 620,
      isUnclassified: true,
    },
  ]
}

/** 表示中の月の未分類取引（自分の分のみ）。一括分類の対象と件数の土台 */
function unclassifiedOwnTransactions(
  role: UserRole,
): { transactionId: string; merchant: string }[] {
  const own = [
    { transactionId: 'TXN_MOCK_004', merchant: 'ドラッグストアA' },
    { transactionId: 'TXN_MOCK_005', merchant: 'カフェB' },
  ]
  return role === 'honey' ? own : [{ transactionId: 'TXN_MOCK_003', merchant: 'Amazon' }, ...own]
}

/** GET /api/transactions/unclassified-summary */
export function unclassifiedSummaryFixture(role: UserRole): unknown {
  const own = unclassifiedOwnTransactions(role)
  return {
    count: own.length,
    recentIds: own.map(item => item.transactionId),
  }
}

/** POST /api/classification/bulk-sessions・GET /api/classification/bulk-sessions/:id */
export function bulkClassificationSessionFixture(role: UserRole): unknown {
  const own = unclassifiedOwnTransactions(role)
  return {
    kind: 'in_progress',
    common: {
      bulkClassificationSessionId: 'BCS_MOCK_001',
      userId: role === 'honey' ? 'U_HONEY_MOCK' : 'U_DARLING_MOCK',
      trigger: {
        kind: 'single_correction',
        transactionId: own[0]?.transactionId ?? 'TXN_MOCK_004',
        startedAt: '2026-07-24T01:00:00.000Z',
      },
      targets: own.map(item => ({
        kind: 'unclassified',
        transactionId: item.transactionId,
        merchantName: item.merchant,
        reason: 'merchant_rule_unlearned',
        defaultExpenseClass: role === 'honey' ? 'personal_honey' : 'personal_darling',
      })),
    },
    startedAt: '2026-07-24T01:00:00.000Z',
    remainingCount: own.length,
  }
}

/** POST /api/classification/bulk-sessions/:id/complete */
export function bulkClassificationCompletedFixture(role: UserRole): unknown {
  const own = unclassifiedOwnTransactions(role)
  return {
    kind: 'completed',
    common: (bulkClassificationSessionFixture(role) as { common: unknown }).common,
    startedAt: '2026-07-24T01:00:00.000Z',
    completedAt: '2026-07-24T01:05:00.000Z',
    processedCount: own.length,
  }
}

/** POST /api/classification/bulk-sessions/:id/abort */
export function bulkClassificationAbortedFixture(role: UserRole): unknown {
  const own = unclassifiedOwnTransactions(role)
  return {
    kind: 'aborted',
    common: (bulkClassificationSessionFixture(role) as { common: unknown }).common,
    startedAt: '2026-07-24T01:00:00.000Z',
    abortedAt: '2026-07-24T01:05:00.000Z',
    remainingCount: own.length,
  }
}

/** GET /api/classification/retroactive-candidates */
export function retroactiveCandidatesFixture(role: UserRole, merchantName: string): unknown {
  return {
    userId: role === 'honey' ? 'U_HONEY_MOCK' : 'U_DARLING_MOCK',
    merchantName,
    candidates: [
      { transactionId: 'TXN_MOCK_101', occurredAt: '2026-06-18T09:10:00.000Z', amount: 1420 },
      { transactionId: 'TXN_MOCK_102', occurredAt: '2026-05-30T12:00:00.000Z', amount: 980 },
    ],
    proposedAt: '2026-07-24T01:00:00.000Z',
  }
}

/**
 * POST /api/classification/retroactive-candidates/apply
 * モックはリクエストボディを見ないため、候補の件数だけ返す（画面が使うのは件数のみ）
 */
export function retroactiveApplyResultFixture(): unknown {
  return { merchantName: 'ドラッグストアA', appliedCount: 2 }
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
export function accountBalanceListFixture(scenario: MockScenario): unknown {
  const automanaged = [
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
  ]
  if (!hasOptionalAccounts(scenario)) return { items: automanaged }
  return {
    items: [
      ...automanaged,
      {
        kind: 'other_savings',
        accountId: 'ACC_MOCK_003',
        displayName: '楽天銀行',
        currentBalance: 1740000,
        lastUpdatedAt: '2026-07-20T00:00:00.000Z',
      },
      // 鮮度アラート（35 日以上未更新）の見た目を両テーマで確認するための口座
      {
        kind: 'other_savings',
        accountId: 'ACC_MOCK_005',
        displayName: 'ゆうちょ銀行',
        currentBalance: 260000,
        lastUpdatedAt: '2026-06-14T00:00:00.000Z',
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

/**
 * GET /api/dashboard/balance-freshness
 *
 * 残高鮮度は本人所有の口座のみを返す（P2-B5 / AT-404）。別銀行貯蓄口座は
 * 1 人 1 件（UNIQUE (owner_user_id, kind)）なので、閲覧者本人の 1 件だけを返し、
 * 鮮度アラートの見た目を両テーマで確認できるようにする。
 * 鮮度の対象は別銀行貯蓄口座（手入力の口座）なので、それが未登録のシナリオでは空になる。
 */
export function balanceFreshnessFixture(scenario: MockScenario): unknown {
  if (!hasOptionalAccounts(scenario)) return { items: [] }
  return {
    items: [
      {
        accountId: 'ACC_MOCK_005',
        displayName: 'ゆうちょ銀行',
        lastUpdatedAt: '2026-06-14T00:00:00.000Z',
        daysSinceLastUpdate: 40,
        status: 'alert',
      },
    ],
  }
}

/** GET /api/balances/total（合計は内訳から求める。内訳と合計が食い違わないため） */
export function assetTotalFixture(scenario: MockScenario): unknown {
  const registered = hasOptionalAccounts(scenario)
  const smbcBalance = 1500000
  const otherSavingsBalance = registered ? 2000000 : 0
  const nisaContributionAccumulated = registered ? 1200000 : 0
  const cardUnpaidTotal = 120000
  return {
    asOf: '2026-07-24T00:00:00.000Z',
    smbcBalance,
    otherSavingsBalance,
    nisaContributionAccumulated,
    cardUnpaidTotal,
    total: smbcBalance + otherSavingsBalance + nisaContributionAccumulated - cardUnpaidTotal,
  }
}

/** GET /api/balances/time-series */
export function balanceTimeSeriesFixture(scenario: MockScenario): unknown {
  const registered = hasOptionalAccounts(scenario)
  return {
    yearMonthRange: { from: '2026-01', to: '2026-07' },
    smbc: [
      { date: '2026-01-31T00:00:00.000Z', amount: 1200000 },
      { date: '2026-04-30T00:00:00.000Z', amount: 1350000 },
      { date: '2026-07-23T00:00:00.000Z', amount: 1500000 },
    ],
    // 未登録の口座は推移そのものが存在しない（0 の系列を返すと「0 円で推移した」に読める）
    otherSavings: registered
      ? [
          { date: '2026-01-31T00:00:00.000Z', amount: 1600000 },
          { date: '2026-04-30T00:00:00.000Z', amount: 1680000 },
          { date: '2026-07-20T00:00:00.000Z', amount: 1740000 },
        ]
      : [],
    nisaContribution: registered
      ? [
          { date: '2026-01-31T00:00:00.000Z', amount: 900000 },
          { date: '2026-04-30T00:00:00.000Z', amount: 1050000 },
          { date: '2026-07-01T00:00:00.000Z', amount: 1200000 },
        ]
      : [],
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

/**
 * GET /api/accounts
 *
 * `accounts-unregistered` では三井住友系（自動管理）だけを返す。設定 > 口座タブの
 * 「別銀行貯蓄口座を追加」「NISA口座を追加」は未登録のときだけ出るため、
 * この状態を用意しないと両ボタンの見た目を自動で写せない（#425）。
 */
export function ownAccountListFixture(scenario: MockScenario): unknown {
  const automanaged = [
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
  ]
  if (!hasOptionalAccounts(scenario)) return { items: automanaged }
  return {
    items: [
      ...automanaged,
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

/**
 * GET /api/expense-settlement/cycles
 *
 * 表示中の月のサイクルを集積中で返す。集積中は「按分子取引を生成」「CSV 確定」が
 * 並ぶ状態で、経費精算画面の操作が最も多く出る（未開始だとカードが空状態と
 * 「サイクルを開始」だけになり、画面のほとんどが写らない）。
 */
export function currentCycleFixture(yearMonth: string): unknown {
  return {
    cycle: {
      kind: 'accumulating',
      common: {
        monthlyExpenseCycleId: 'MEC_MOCK_001',
        targetYearMonth: yearMonth,
        // 月次サイクルは月初に始まる（#485）。表示中の月に合わせて食い違わせない
        cycleStartedAt: `${yearMonth}-01T00:00:00.000Z`,
      },
    },
  }
}

/**
 * GET /api/expense-settlement
 *
 * 費用区分別の累計は、上限つき（上限到達・進捗バー）と上限なしの両方を返して
 * 行の見え方を一覧で確認できるようにする。expenseTypeId は
 * {@link expenseTypeListFixture} と揃える（揃っていないと画面が名前を解決できず
 * ID がそのまま出る）。日時は JST の暦日が UTC と食い違わないよう 15:00Z より前に置く。
 *
 * 数値は集約の規則どおりに組む（上限超過分は按分子取引へ回るので、
 * 累計 = 全額計上ぶん + 上限までの残り、按分子取引の金額 = 超過ぶん）。
 * 画面のどこかで足し算が合わないと、プレビューを見た人が実装の不具合と読む。
 */
export function expenseSettlementViewFixture(role: UserRole): unknown {
  const userId = role === 'honey' ? 'U_HONEY_MOCK' : 'U_DARLING_MOCK'
  return {
    userId,
    currentAccumulations: [
      {
        kind: 'capped',
        accumulationId: 'ETA_MOCK_001',
        expenseTypeId: 'ET_MOCK_001',
        userId,
        monthlyCap: 30000,
        currentTotal: 30000,
        capReached: {
          kind: 'reached',
          reachedAt: '2026-07-16T02:10:00.000Z',
          reachingTransactionId: 'TXN_MOCK_202',
        },
        transactionRefs: [
          {
            transactionId: 'TXN_MOCK_201',
            occurredAt: '2026-07-09T01:30:00.000Z',
            amount: 20800,
            allocation: { kind: 'full' },
          },
          {
            transactionId: 'TXN_MOCK_202',
            occurredAt: '2026-07-16T02:10:00.000Z',
            amount: 12400,
            allocation: {
              kind: 'partial',
              expenseAllocatedAmount: 9200,
              personalAllocatedAmount: 3200,
              childTransactionId: 'TXN_MOCK_301',
            },
          },
        ],
      },
      {
        kind: 'unlimited',
        accumulationId: 'ETA_MOCK_002',
        expenseTypeId: 'ET_MOCK_002',
        userId,
        currentTotal: 7920,
        transactionRefs: [
          {
            transactionId: 'TXN_MOCK_203',
            occurredAt: '2026-07-11T05:00:00.000Z',
            amount: 7920,
            allocation: { kind: 'full' },
          },
        ],
      },
    ],
    currentChildTransactions: [
      {
        childTransactionId: 'TXN_MOCK_301',
        parentTransactionId: 'TXN_MOCK_202',
        userId,
        personalAmount: 3200,
        personalExpenseClass: role === 'honey' ? 'personal_honey' : 'personal_darling',
        derivedAt: '2026-07-16T02:10:00.000Z',
        prorationBasis: {
          kind: 'cap_excess_fifo',
          monthlyExpenseCycleId: 'MEC_MOCK_001',
          proratedAt: '2026-07-16T02:10:00.000Z',
          capRemainderAtExcess: 9200,
        },
      },
    ],
    latestFinalizedCycle: {
      monthlyExpenseCycleId: 'MEC_MOCK_000',
      targetYearMonth: '2026-06',
      finalizedAt: '2026-07-10T03:00:00.000Z',
      unapprovedTotal: 4800,
    },
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

/**
 * POST /api/imports/pdf の失敗応答（実 API は 422 + 失敗ジョブ）。
 * モックは Anthropic API を呼べないため、変換失敗の画面を確認できる側に倒している。
 */
export function pdfConversionFailedResponseFixture(): unknown {
  return {
    job: {
      kind: 'failed',
      common: {
        importJobId: 'JOB_MOCK_PDF',
        targetMonth: '2026-07',
        fileKind: 'card_statement',
        fileFormat: 'pdf',
        fileRef: 'FILE_MOCK_PDF',
      },
      failedAt: '2026-07-05T10:00:00.000Z',
      failureReason: {
        kind: 'pdf_conversion_failed',
        reason: 'total_amount_mismatch',
        failureDetail: '合計金額が一致しない（抽出 128,400 / 記載 131,900）',
        detectedAt: '2026-07-05T10:00:00.000Z',
      },
    },
    conversionFailureReason: 'total_amount_mismatch',
  }
}

/**
 * GET /api/classification/merchant-rules
 *
 * 学習データは完全個人別（08b F-1）なので、閲覧ロールごとに別のルールを返す。
 * 経費(会社) を含む学習は本人だけが見られる情報のため、両ロールで同じ内容を返すと
 * プレビュー画面が「相手の経費学習が見えている」ように読めてしまう。
 * 学習中（3 軸学習済み / 一部未学習）と学習停止中を含め、行の見え方を一覧で確認できるようにする。
 * categoryId / expenseTypeId は categoryListFixture / expenseTypeListFixture の値と揃える。
 * 日時は JST の暦日が UTC と食い違わないよう 15:00Z より前に置く（基準画像がタイムゾーン依存になる）。
 */
export function merchantLearningRuleListFixture(role: UserRole): unknown {
  const userId = role === 'honey' ? 'U_HONEY_MOCK' : 'U_DARLING_MOCK'
  if (role === 'honey') {
    return {
      items: [
        {
          kind: 'active',
          common: { userId, merchantName: 'カルディ 恵比寿店' },
          categoryRef: { kind: 'learned', categoryId: '01HQ8ZKJ9M3N4P5Q6R7S8T9VWY' },
          expenseClassRef: { kind: 'learned', expenseClass: 'household' },
          expenseTypeRef: { kind: 'unlearned' },
          lastUpdatedAt: '2026-07-19T02:40:00.000Z',
        },
        {
          kind: 'disabled',
          common: { userId, merchantName: 'コンビニ各種' },
          disabledAt: '2026-07-02T05:00:00.000Z',
        },
      ],
    }
  }
  return {
    items: [
      {
        kind: 'active',
        common: { userId, merchantName: 'ライフ 中目黒店' },
        categoryRef: { kind: 'learned', categoryId: '01HQ8ZKJ9M3N4P5Q6R7S8T9VWY' },
        expenseClassRef: { kind: 'learned', expenseClass: 'household' },
        expenseTypeRef: { kind: 'unlearned' },
        lastUpdatedAt: '2026-07-18T04:20:00.000Z',
      },
      {
        kind: 'active',
        common: { userId, merchantName: 'メトロ 定期券' },
        categoryRef: { kind: 'learned', categoryId: '01HQ8ZKJ9M3N4P5Q6R7S8T9VW0' },
        expenseClassRef: { kind: 'learned', expenseClass: 'business_expense' },
        expenseTypeRef: { kind: 'learned', expenseTypeId: 'ET_MOCK_001' },
        lastUpdatedAt: '2026-07-05T09:10:00.000Z',
      },
      {
        kind: 'disabled',
        common: { userId, merchantName: 'セブンイレブン' },
        disabledAt: '2026-06-30T12:00:00.000Z',
      },
    ],
  }
}

/** GET /api/classification/amazon-rules（merchant-rules と同じくロール別。F-1） */
export function amazonProductKeyLearningRuleListFixture(role: UserRole): unknown {
  if (role === 'honey') {
    return {
      items: [
        {
          userId: 'U_HONEY_MOCK',
          amazonProductKey: '日用品 / 詰め替え洗剤',
          categoryRef: { kind: 'learned', categoryId: '01HQ8ZKJ9M3N4P5Q6R7S8T9VW0' },
          expenseClassRef: { kind: 'learned', expenseClass: 'household' },
          expenseTypeRef: { kind: 'unlearned' },
          lastUpdatedAt: '2026-07-14T01:30:00.000Z',
        },
      ],
    }
  }
  return {
    items: [
      {
        userId: 'U_DARLING_MOCK',
        amazonProductKey: '技術書 / プログラミング',
        categoryRef: { kind: 'learned', categoryId: '01HQ8ZKJ9M3N4P5Q6R7S8T9VW0' },
        expenseClassRef: { kind: 'learned', expenseClass: 'business_expense' },
        expenseTypeRef: { kind: 'learned', expenseTypeId: 'ET_MOCK_002' },
        lastUpdatedAt: '2026-07-12T09:00:00.000Z',
      },
    ],
  }
}
