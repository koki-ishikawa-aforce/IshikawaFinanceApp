/**
 * モック起動モード（NEXT_PUBLIC_MOCK=1）用の固定 fixture データ。
 *
 * LIFF 認証・実 API なしでダッシュボードを描画するためのワイヤー形式レスポンスを返す。
 * サーバーの JSON 応答をそのまま模しており、呼び出し側（api-client）で
 * 実 API と同じ Zod スキーマ検証を通す。ここにはドメインの不変条件・配色などの
 * 知識は持ち込まない（純粋な表示用サンプル値のみ）。
 */
import type { DashboardMode, UserRole, YearMonth } from '@warimaru/domain'
import { shiftMonth } from '@/lib/month'
import type { MockScenario } from './scenario'

/**
 * シャドウ口座（別銀行貯蓄口座・NISA 口座。利用者が自分で登録し、残高も手入力する口座）
 * が登録済みか。`accounts-unregistered` シナリオでは、これらを持つ fixture から
 * 一律に取り除く（設定では未登録なのに残高一覧には出ている、という食い違いを作らない）。
 */
function hasShadowAccounts(scenario: MockScenario): boolean {
  return scenario === 'default'
}

/**
 * 口座を 1 件でも登録済みか。`accounts-none` は #395 以降の新規利用者の初期状態
 * （三井住友系も利用者が登録するようになったため、口座がまったく無い状態から始まる）。
 */
function hasAnyAccounts(scenario: MockScenario): boolean {
  return scenario !== 'accounts-none'
}

/**
 * 相手（配偶者）の別銀行貯蓄 + NISA 積立累計の合計。相手について見えるのはこの合計だけで、
 * 銀行名も口座件数も出ない（P2-B5 / AT-404）。世帯合計の内数。
 */
const SPOUSE_SAVINGS_NISA_TOTAL = 260000

/**
 * 口座ごとの金額の素の値。ダッシュボードの KPI と残高画面の資産合計を同じ値から導き、
 * 同じプレビューで画面ごとに違う合計が出ないようにする。いずれも世帯（夫婦 2 人分）の合計。
 * 別銀行貯蓄の 2,000,000 は本人の楽天銀行 1,740,000 と相手の 260,000
 * （{@link SPOUSE_SAVINGS_NISA_TOTAL}）の合算。
 */
function accountAmounts(scenario: MockScenario) {
  const shadow = hasShadowAccounts(scenario)
  const any = hasAnyAccounts(scenario)
  return {
    smbcBalance: any ? 1500000 : 0,
    otherSavingsBalance: shadow ? 2000000 : 0,
    nisaContributionAccumulated: shadow ? 1200000 : 0,
    cardUnpaidTotal: any ? 120000 : 0,
  }
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
 * 貯蓄・NISA の額は口座の登録状況に従い、資産合計はビューの定義どおりに求める
 * （貯蓄残高 = SMBC + 別銀行貯蓄合算、資産合計 = 貯蓄残高 + NISA − カード未払金。
 * `DashboardKpisView` を参照）。素の値は残高画面と共有しているので、シャドウ口座が
 * 未登録のシナリオでもダッシュボードと残高画面で合計が食い違わない。
 */
export function dashboardKpisFixture(mode: DashboardMode, scenario: MockScenario): unknown {
  const amounts = accountAmounts(scenario)
  const savingsBalance = amounts.smbcBalance + amounts.otherSavingsBalance
  const assets = {
    savingsBalance,
    nisaContributionAccumulated: amounts.nisaContributionAccumulated,
    totalAssets: savingsBalance + amounts.nisaContributionAccumulated - amounts.cardUnpaidTotal,
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
        kind: 'transaction_list',
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
    classifiedTransactionIds: [],
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

/**
 * GET /api/balances
 *
 * 一覧に並ぶのは閲覧者本人の口座だけで、相手の分は「別銀行貯蓄 + NISA」の合計 1 件に
 * まとまる（P2-B5 / AT-404）。本人の別銀行貯蓄が 1 件なのは、口座種別ごとに 1 人 1 件
 * （UNIQUE (owner_user_id, kind)）のため。相手の合計 {@link SPOUSE_SAVINGS_NISA_TOTAL} は
 * 世帯合計（{@link accountAmounts}）の内数で、本人分と足すと資産合計の内訳に一致する。
 */
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
  if (!hasAnyAccounts(scenario)) return { items: [], spouseOtherSavingsAndNisaTotal: null }
  if (!hasShadowAccounts(scenario))
    return { items: automanaged, spouseOtherSavingsAndNisaTotal: null }
  return {
    items: [
      ...automanaged,
      // 鮮度アラート（35 日以上未更新）の見た目を両テーマで確認するため、最終更新を古くする
      {
        kind: 'other_savings',
        accountId: 'ACC_MOCK_003',
        displayName: '楽天銀行',
        currentBalance: 1740000,
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
    spouseOtherSavingsAndNisaTotal: SPOUSE_SAVINGS_NISA_TOTAL,
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
  if (!hasShadowAccounts(scenario)) return { items: [] }
  return {
    items: [
      {
        accountId: 'ACC_MOCK_003',
        displayName: '楽天銀行',
        lastUpdatedAt: '2026-06-14T00:00:00.000Z',
        daysSinceLastUpdate: 40,
        status: 'alert',
      },
    ],
  }
}

/** GET /api/balances/total（合計は内訳から求める。内訳と合計が食い違わないため） */
export function assetTotalFixture(scenario: MockScenario): unknown {
  const amounts = accountAmounts(scenario)
  return {
    asOf: '2026-07-24T00:00:00.000Z',
    ...amounts,
    total:
      amounts.smbcBalance +
      amounts.otherSavingsBalance +
      amounts.nisaContributionAccumulated -
      amounts.cardUnpaidTotal,
  }
}

/** GET /api/balances/time-series */
export function balanceTimeSeriesFixture(scenario: MockScenario): unknown {
  const registered = hasShadowAccounts(scenario)
  const any = hasAnyAccounts(scenario)
  return {
    yearMonthRange: { from: '2026-01', to: '2026-07' },
    smbc: any
      ? [
          { date: '2026-01-31T00:00:00.000Z', amount: 1200000, isCarriedForward: false },
          { date: '2026-04-30T00:00:00.000Z', amount: 1350000, isCarriedForward: false },
          { date: '2026-07-23T00:00:00.000Z', amount: 1500000, isCarriedForward: false },
        ]
      : [],
    // 未登録の口座は推移そのものが存在しない（0 の系列を返すと「0 円で推移した」に読める）
    otherSavings: registered
      ? [
          { date: '2026-01-31T00:00:00.000Z', amount: 1600000, isCarriedForward: false },
          { date: '2026-04-30T00:00:00.000Z', amount: 1680000, isCarriedForward: false },
          { date: '2026-07-20T00:00:00.000Z', amount: 1740000, isCarriedForward: false },
        ]
      : [],
    nisaContribution: registered
      ? [
          { date: '2026-01-31T00:00:00.000Z', amount: 900000, isCarriedForward: false },
          { date: '2026-04-30T00:00:00.000Z', amount: 1050000, isCarriedForward: false },
          { date: '2026-07-01T00:00:00.000Z', amount: 1200000, isCarriedForward: false },
        ]
      : [],
    cardUnpaid: any
      ? [
          { date: '2026-01-31T00:00:00.000Z', amount: 95000, isCarriedForward: false },
          { date: '2026-04-30T00:00:00.000Z', amount: 110000, isCarriedForward: false },
          { date: '2026-07-10T00:00:00.000Z', amount: 120000, isCarriedForward: false },
        ]
      : [],
  }
}

/**
 * GET /api/balances/accounts/:accountId（口座詳細、#406）
 *
 * 実 API は本人の口座だけを返し、他人の口座も存在しない口座も 404 にする。モックも
 * 用意していない口座IDでは null を返し、呼び出し側が 404 相当として扱えるようにする。
 *
 * 別銀行貯蓄（ACC_MOCK_003）は手入力の口座なので、自動反映と手入力が混ざった履歴を持たせる
 * （どちらか一方しか無いと、履歴の見た目を両方とも見張れない）。
 */
export function accountDetailFixture(accountId: string, scenario: MockScenario): unknown {
  const details: Record<string, unknown> = {
    ACC_MOCK_001: {
      accountId: 'ACC_MOCK_001',
      kind: 'smbc_bank',
      displayName: '三井住友銀行',
      isActive: true,
      currentValue: 1500000,
      lastUpdatedAt: '2026-07-23T00:00:00.000Z',
      supportsBalanceManualEntry: false,
      series: [
        { date: '2026-02-01T00:00:00.000Z', amount: 1250000, isCarriedForward: false },
        { date: '2026-04-30T00:00:00.000Z', amount: 1350000, isCarriedForward: false },
        { date: '2026-07-23T00:00:00.000Z', amount: 1500000, isCarriedForward: false },
      ],
      history: [
        {
          occurredAt: '2026-07-23T00:00:00.000Z',
          valueAfter: 1500000,
          delta: 150000,
          source: 'auto',
        },
        {
          occurredAt: '2026-04-30T00:00:00.000Z',
          valueAfter: 1350000,
          delta: 100000,
          source: 'auto',
        },
      ],
    },
    ACC_MOCK_003: {
      accountId: 'ACC_MOCK_003',
      kind: 'other_savings',
      displayName: '楽天銀行',
      isActive: true,
      currentValue: 1740000,
      lastUpdatedAt: '2026-06-14T00:00:00.000Z',
      supportsBalanceManualEntry: true,
      series: [
        { date: '2026-02-01T00:00:00.000Z', amount: 1620000, isCarriedForward: false },
        { date: '2026-04-18T00:00:00.000Z', amount: 1700000, isCarriedForward: false },
        { date: '2026-05-06T00:00:00.000Z', amount: 1670000, isCarriedForward: false },
        { date: '2026-06-14T00:00:00.000Z', amount: 1740000, isCarriedForward: false },
      ],
      history: [
        {
          occurredAt: '2026-06-14T00:00:00.000Z',
          valueAfter: 1740000,
          delta: 70000,
          source: 'manual_correction',
          memo: '通帳を見て入れ直した',
        },
        {
          occurredAt: '2026-05-06T00:00:00.000Z',
          valueAfter: 1670000,
          delta: -30000,
          source: 'manual_withdrawal',
          memo: '旅行費として引き出し',
        },
        {
          occurredAt: '2026-04-18T00:00:00.000Z',
          valueAfter: 1700000,
          delta: 80000,
          source: 'auto',
        },
      ],
    },
  }
  if (!hasShadowAccounts(scenario) && accountId === 'ACC_MOCK_003') return null
  if (!hasAnyAccounts(scenario)) return null
  const detail = details[accountId]
  if (detail === undefined) return null
  return { ...detail, yearMonthRange: { from: '2026-02', to: '2026-07' } }
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
 * 実 API は本人所有の口座だけを返すため、所有者は閲覧ロールに合わせる
 * （固定にすると honey で開いたときに相手所有の口座一覧を見ている状態になる）。
 * `accounts-unregistered` では三井住友系だけを、`accounts-none` では 1 件も返さない。
 * 設定 > 口座タブの追加ボタンは未登録の種別にだけ出るため、この 2 つの状態を用意しないと
 * ボタンの見た目を自動で写せない（#425 / #395。口座 4 種すべての追加ボタンが並ぶのは
 * `accounts-none` のときだけ）。
 */
export function ownAccountListFixture(role: UserRole, scenario: MockScenario): unknown {
  const ownerUserId = role === 'honey' ? 'U_HONEY_MOCK' : 'U_DARLING_MOCK'
  const automanaged = [
    {
      kind: 'smbc_bank',
      common: {
        accountId: 'ACC_MOCK_001',
        ownerUserId,
        activeness: { kind: 'active' },
      },
      balance: { currentBalance: 1500000 },
    },
    {
      kind: 'mitsui_sumitomo_card',
      common: {
        accountId: 'ACC_MOCK_002',
        ownerUserId,
        activeness: { kind: 'active' },
      },
    },
  ]
  if (!hasAnyAccounts(scenario)) return { items: [] }
  if (!hasShadowAccounts(scenario)) return { items: automanaged }
  return {
    items: [
      ...automanaged,
      {
        kind: 'other_savings',
        common: {
          accountId: 'ACC_MOCK_003',
          ownerUserId,
          activeness: { kind: 'active' },
        },
        bankName: '楽天銀行',
        balance: { currentBalance: 1740000 },
      },
      {
        kind: 'nisa',
        common: {
          accountId: 'ACC_MOCK_004',
          ownerUserId,
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
export function currentCycleFixture(yearMonth: YearMonth): unknown {
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
 * 費用区分別の累計は、上限つき（上限に到達した状態）と上限なしの両方を返して
 * 行の見え方を一覧で確認できるようにする（月次上限と進捗バーが出る行と「上限なし」の
 * 行が並ぶ。DESIGN.md §1）。expenseTypeId は
 * {@link expenseTypeListFixture} と揃える（揃っていないと画面が名前を解決できず
 * ID がそのまま出る）。日時は JST の暦日が UTC と食い違わないよう 15:00Z より前に置く。
 *
 * 数値は集約の規則どおりに組む（上限超過分は按分子取引へ回るので、
 * 累計 = 全額計上ぶん + 上限までの残り、按分子取引の金額 = 超過ぶん）。
 * 画面のどこかで足し算が合わないと、プレビューを見た人が実装の不具合と読む。
 *
 * 累計と按分子取引はどの月を開いても同じ内容を返す（モックは月ごとのデータを持たない）。
 * 直近の確定サイクルだけは表示中の月の前月に合わせる。固定にすると、その月を開いたときに
 * 「集積中のサイクル」と「同じ月が最終確定済み」が同じ画面に並んで矛盾するため。
 */
export function expenseSettlementViewFixture(role: UserRole, yearMonth: YearMonth): unknown {
  const userId = role === 'honey' ? 'U_HONEY_MOCK' : 'U_DARLING_MOCK'
  const previousMonth = shiftMonth(yearMonth, -1)
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
      targetYearMonth: previousMonth,
      // 前月分は当月の 10 日に確定した、という並び（暦日が UTC とずれない 15:00Z 前）
      finalizedAt: `${yearMonth}-10T03:00:00.000Z`,
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
