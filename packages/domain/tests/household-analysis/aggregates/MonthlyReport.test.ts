import { describe, it, expect } from 'vitest'
import {
  MonthlyReportSchema,
  finalize,
  confirmCsv,
  refreshCsvConfirmed,
  freezeBalanceSnapshot,
  aggregateMonthlyReportTotals,
  isIncompleteMonthReport,
  selfTotalsOf,
  CommonMonthlyReportAttrsSchema,
  type CsvConfirmedReport,
} from '../../../src/household-analysis/aggregates/MonthlyReport'
import {
  TransactionSchema,
  type Transaction,
} from '../../../src/household-analysis/aggregates/Transaction'
import type { UserId } from '../../../src/shared/ids'
import type { ExpenseClass } from '../../../src/shared/value-objects/ExpenseClass'

const baseCommon = {
  monthlyReportId: '01REP000000000000000000001' as never,
  targetYearMonth: '2026-04' as never,
  householdCategoryTotals: [],
  personalTotalHoney: 0 as never,
  personalTotalDarling: 0 as never,
  businessExpenseTotalHoney: 0 as never,
  businessExpenseTotalDarling: 0 as never,
  nisaContributionAccumulated: 0 as never,
  balanceTrend: {
    smbcBalanceTrend: [],
    otherSavingsBalanceTrend: [],
    nisaContributionTrend: [],
    cardUnpaidTrend: [],
  },
}

describe('MonthlyReport 集約', () => {
  it('CSV確定状態を parse できる', () => {
    expect(() =>
      MonthlyReportSchema.parse({
        kind: 'csv_confirmed',
        common: baseCommon,
        csvConfirmedAt: new Date(),
        causingTransactionIds: [],
      }),
    ).not.toThrow()
  })

  it('最終確定状態を parse できる', () => {
    expect(() =>
      MonthlyReportSchema.parse({
        kind: 'finalized',
        common: baseCommon,
        csvConfirmedAt: new Date(),
        finalizedAt: new Date(),
        expenseReimbursementId: '01RMB000000000000000000001' as never,
        expenseReimbursementMatchedAt: new Date(),
        unapprovedTransfers: [],
      }),
    ).not.toThrow()
  })

  it('finalize() は CSV確定 → 最終確定の遷移を生成する', () => {
    const csvConfirmed = MonthlyReportSchema.parse({
      kind: 'csv_confirmed',
      common: baseCommon,
      csvConfirmedAt: new Date('2026-05-01'),
      causingTransactionIds: [],
    }) as CsvConfirmedReport

    const finalized = finalize(
      csvConfirmed,
      '01RMB000000000000000000001' as never,
      new Date('2026-05-15'),
      [],
      new Date('2026-05-16'),
    )

    expect(finalized.kind).toBe('finalized')
    expect(finalized.csvConfirmedAt).toEqual(new Date('2026-05-01'))
  })

  it('finalize() は不正データなら throw', () => {
    const csvConfirmed = MonthlyReportSchema.parse({
      kind: 'csv_confirmed',
      common: baseCommon,
      csvConfirmedAt: new Date('2026-05-01'),
      causingTransactionIds: [],
    }) as CsvConfirmedReport

    expect(() => finalize(csvConfirmed, '' as never, new Date(), [], new Date())).toThrow()
  })
})

// --- #64: CSV確定昇格・再集計・取引集計 ---

const roleOfOwner = (userId: UserId) => (String(userId).includes('honey') ? 'honey' : 'darling')

function classifiedTx(
  suffix: number,
  ownerUserId: string,
  amount: number,
  expenseClass: ExpenseClass,
  options: { categoryId?: string; businessExpense?: boolean } = {},
): Transaction {
  const expenseTypeRef =
    expenseClass === 'business_expense'
      ? { kind: 'business' as const, expenseTypeId: '01EXP000000000000000000001' as never }
      : { kind: 'non_business' as const }
  return TransactionSchema.parse({
    kind: 'classified',
    common: {
      transactionId: `01TX000000000000000000000${suffix}` as never,
      ownerUserId: ownerUserId as never,
      merchantName: 'テスト加盟店',
      amount: amount as never,
      occurredAt: new Date('2026-04-10'),
      importSource: {
        kind: 'manual',
        enteredAt: new Date('2026-04-10'),
        enteredByUserId: ownerUserId as never,
      },
    },
    details: {
      categoryId: (options.categoryId ?? '01CAT000000000000000000001') as never,
      expenseClass,
      expenseTypeRef,
      basis: {
        kind: 'user_manual',
        modifiedByUserId: ownerUserId as never,
        modifiedAt: new Date('2026-04-10'),
      },
    },
  })
}

describe('aggregateMonthlyReportTotals()', () => {
  it('費用区分別に集計する（世帯はカテゴリ別、個人は honey/darling 別、経費は所有者役割別）', () => {
    const totals = aggregateMonthlyReportTotals(
      [
        classifiedTx(1, 'user_honey', 3000, 'household'),
        classifiedTx(2, 'user_darling', 2000, 'household'),
        classifiedTx(3, 'user_honey', 5000, 'household', {
          categoryId: '01CAT000000000000000000002',
        }),
        classifiedTx(4, 'user_honey', 1200, 'personal_honey'),
        classifiedTx(5, 'user_darling', 800, 'personal_darling'),
        classifiedTx(6, 'user_honey', 10000, 'business_expense'),
        classifiedTx(7, 'user_darling', 4000, 'business_expense'),
      ],
      roleOfOwner,
    )

    expect(totals.householdCategoryTotals).toEqual([
      { categoryId: '01CAT000000000000000000001', total: 5000 },
      { categoryId: '01CAT000000000000000000002', total: 5000 },
    ])
    expect(totals.personalTotalHoney).toBe(1200)
    expect(totals.personalTotalDarling).toBe(800)
    expect(totals.businessExpenseTotalHoney).toBe(10000)
    expect(totals.businessExpenseTotalDarling).toBe(4000)
  })

  it('経費(会社) は世帯・個人の集計に含まれない（非対称ルール）', () => {
    const totals = aggregateMonthlyReportTotals(
      [classifiedTx(1, 'user_honey', 9999, 'business_expense')],
      roleOfOwner,
    )
    expect(totals.householdCategoryTotals).toEqual([])
    expect(totals.personalTotalHoney).toBe(0)
    expect(totals.personalTotalDarling).toBe(0)
    expect(totals.businessExpenseTotalHoney).toBe(9999)
  })

  it('未分類・削除済み取引は集計対象外', () => {
    const unclassified = TransactionSchema.parse({
      kind: 'unclassified',
      common: {
        transactionId: '01TX0000000000000000000008' as never,
        ownerUserId: 'user_honey' as never,
        merchantName: 'テスト加盟店',
        amount: 7777 as never,
        occurredAt: new Date('2026-04-10'),
        importSource: {
          kind: 'manual',
          enteredAt: new Date('2026-04-10'),
          enteredByUserId: 'user_honey' as never,
        },
      },
      reason: 'merchant_rule_unlearned',
      defaultExpenseClass: 'personal_honey',
    })
    const deleted = TransactionSchema.parse({
      kind: 'deleted',
      common: {
        transactionId: '01TX0000000000000000000009' as never,
        ownerUserId: 'user_honey' as never,
        merchantName: 'テスト加盟店',
        amount: 8888 as never,
        occurredAt: new Date('2026-04-10'),
        importSource: {
          kind: 'manual',
          enteredAt: new Date('2026-04-10'),
          enteredByUserId: 'user_honey' as never,
        },
      },
      deletedAt: new Date('2026-04-11'),
      deletionReason: 'user_deleted',
    })

    const totals = aggregateMonthlyReportTotals(
      [unclassified, deleted, classifiedTx(1, 'user_honey', 100, 'household')],
      roleOfOwner,
    )
    expect(totals.householdCategoryTotals).toEqual([
      { categoryId: '01CAT000000000000000000001', total: 100 },
    ])
    expect(totals.personalTotalHoney).toBe(0)
  })
})

describe('confirmCsv() / refreshCsvConfirmed()', () => {
  it('confirmCsv() は共通属性と起因取引IDから CSV確定月次レポートを生成する', () => {
    const report = confirmCsv(
      baseCommon as never,
      ['01TX0000000000000000000001' as never],
      new Date('2026-05-01'),
    )
    expect(report.kind).toBe('csv_confirmed')
    expect(report.csvConfirmedAt).toEqual(new Date('2026-05-01'))
    expect(report.causingTransactionIds).toEqual(['01TX0000000000000000000001'])
  })

  it('confirmCsv() は不正データなら throw', () => {
    expect(() =>
      confirmCsv({ ...baseCommon, personalTotalHoney: 1.5 } as never, [], new Date()),
    ).toThrow()
  })

  it('refreshCsvConfirmed() は集計値と起因取引IDを更新し、レポートID・対象年月・CSV確定日時は引き継ぐ', () => {
    const report = confirmCsv(
      baseCommon as never,
      ['01TX0000000000000000000001' as never],
      new Date('2026-05-01'),
    )
    const refreshed = refreshCsvConfirmed(
      report,
      {
        householdCategoryTotals: [
          { categoryId: '01CAT000000000000000000001' as never, total: 5000 as never },
        ],
        personalTotalHoney: 1200 as never,
        personalTotalDarling: 800 as never,
        businessExpenseTotalHoney: 0 as never,
        businessExpenseTotalDarling: 0 as never,
      },
      ['01TX0000000000000000000001' as never, '01TX0000000000000000000002' as never],
    )

    expect(refreshed.kind).toBe('csv_confirmed')
    expect(refreshed.common.monthlyReportId).toBe(baseCommon.monthlyReportId)
    expect(refreshed.common.targetYearMonth).toBe(baseCommon.targetYearMonth)
    expect(refreshed.common.personalTotalHoney).toBe(1200)
    expect(refreshed.causingTransactionIds).toHaveLength(2)
    expect(refreshed.csvConfirmedAt).toEqual(new Date('2026-05-01'))
  })

  it('不完全月フラグは再集計・最終確定を通しても残る', () => {
    // 運用開始月のレポートは翌月の通常サイクルで CSV を取り込み直してから配信される（論点20）。
    // 途中でフラグが落ちると、実際に届くサマリから注意書きだけが静かに消える
    const report = confirmCsv({ ...baseCommon, isIncompleteMonth: true } as never, [], new Date())
    const refreshed = refreshCsvConfirmed(
      report,
      {
        householdCategoryTotals: [],
        personalTotalHoney: 1200 as never,
        personalTotalDarling: 0 as never,
        businessExpenseTotalHoney: 0 as never,
        businessExpenseTotalDarling: 0 as never,
      },
      [],
    )
    expect(isIncompleteMonthReport(refreshed.common)).toBe(true)

    const finalized = finalize(
      refreshed,
      '01ERD000000000000000000001' as never,
      new Date('2026-06-10'),
      [],
      new Date('2026-06-10'),
    )
    expect(isIncompleteMonthReport(finalized.common)).toBe(true)
  })
})

describe('freezeBalanceSnapshot()（#398）', () => {
  const snapshot = {
    smbc: [{ occurredAt: new Date('2026-04-10'), value: 1500000 as never }],
    otherSavings: [{ occurredAt: new Date('2026-04-11'), value: 800000 as never }],
    nisaContribution: [
      { occurredAt: new Date('2026-04-12'), value: 300000 as never },
      { occurredAt: new Date('2026-04-20'), value: 350000 as never },
    ],
    cardUnpaid: [{ occurredAt: new Date('2026-04-13'), value: 42000 as never }],
    nisaContributionAccumulated: 350000 as never,
  }

  const emptySnapshot = {
    smbc: [],
    otherSavings: [],
    nisaContribution: [],
    cardUnpaid: [],
    nisaContributionAccumulated: null,
  }

  it('4 軸の点を 08c の語彙（残高 / 積立累計 / 未払い合計）へ翻訳して写し取る', () => {
    const report = confirmCsv(baseCommon as never, [], new Date('2026-05-01'))
    const frozen = freezeBalanceSnapshot(report, snapshot)

    expect(frozen.common.balanceTrend.smbcBalanceTrend).toEqual([
      { date: new Date('2026-04-10'), balance: 1500000 },
    ])
    expect(frozen.common.balanceTrend.otherSavingsBalanceTrend).toEqual([
      { date: new Date('2026-04-11'), balance: 800000 },
    ])
    expect(frozen.common.balanceTrend.nisaContributionTrend.map(p => p.accumulated)).toEqual([
      300000, 350000,
    ])
    expect(frozen.common.balanceTrend.cardUnpaidTrend).toEqual([
      { date: new Date('2026-04-13'), unpaidTotal: 42000 },
    ])
    expect(frozen.common.nisaContributionAccumulated).toBe(350000)
  })

  it('集計値・起因取引ID・CSV確定日時は触らない', () => {
    const report = confirmCsv(
      { ...baseCommon, personalTotalHoney: 1200 } as never,
      ['01TX0000000000000000000001' as never],
      new Date('2026-05-01'),
    )
    const frozen = freezeBalanceSnapshot(report, snapshot)

    expect(frozen.common.personalTotalHoney).toBe(1200)
    expect(frozen.causingTransactionIds).toEqual(['01TX0000000000000000000001'])
    expect(frozen.csvConfirmedAt).toEqual(new Date('2026-05-01'))
    expect(frozen.common.monthlyReportId).toBe(baseCommon.monthlyReportId)
  })

  it('同じ写しを二度当てても結果は変わらない（履歴が正なので何度写しても収束する）', () => {
    const report = confirmCsv(baseCommon as never, [], new Date('2026-05-01'))
    const once = freezeBalanceSnapshot(report, snapshot)
    expect(freezeBalanceSnapshot(once, snapshot)).toEqual(once)
  })

  it('積立累計が null（履歴なし）なら既存の値を残す — 0 で上書きしない', () => {
    // LINE の月次サマリは「NISA 積立累計」行を値の有無に関わらず描くため、
    // ここで 0 を入れると実際とは違う金額が配信される
    const report = confirmCsv(
      { ...baseCommon, nisaContributionAccumulated: 300000 } as never,
      [],
      new Date('2026-05-01'),
    )
    const frozen = freezeBalanceSnapshot(report, emptySnapshot)
    expect(frozen.common.nisaContributionAccumulated).toBe(300000)
    expect(frozen.common.balanceTrend.nisaContributionTrend).toEqual([])
  })

  it('点が 1 つも無い軸は空配列のまま（0 円の残高と取り違えない）', () => {
    const report = confirmCsv(baseCommon as never, [], new Date('2026-05-01'))
    const frozen = freezeBalanceSnapshot(report, { ...snapshot, smbc: [] })
    expect(frozen.common.balanceTrend.smbcBalanceTrend).toEqual([])
  })

  it('元のレポートは書き換えない', () => {
    const report = confirmCsv(baseCommon as never, [], new Date('2026-05-01'))
    freezeBalanceSnapshot(report, snapshot)
    expect(report.common.balanceTrend.smbcBalanceTrend).toEqual([])
    expect(report.common.nisaContributionAccumulated).toBe(0)
  })

  it('壊れた写し（小数の金額）は throw する', () => {
    const report = confirmCsv(baseCommon as never, [], new Date('2026-05-01'))
    expect(() =>
      freezeBalanceSnapshot(report, {
        ...snapshot,
        nisaContributionAccumulated: 1.5 as never,
      }),
    ).toThrow()
  })
})

describe('selfTotalsOf', () => {
  const common = {
    ...baseCommon,
    personalTotalHoney: 31000,
    personalTotalDarling: 27500,
    businessExpenseTotalHoney: 12000,
    businessExpenseTotalDarling: 4500,
  }

  it('honey には honey の個人費用と経費(会社)だけを返す', () => {
    expect(selfTotalsOf(CommonMonthlyReportAttrsSchema.parse(common), 'honey')).toEqual({
      personalTotalSelf: 31000,
      businessExpenseTotalSelf: 12000,
    })
  })

  it('darling には darling の値だけを返す', () => {
    expect(selfTotalsOf(CommonMonthlyReportAttrsSchema.parse(common), 'darling')).toEqual({
      personalTotalSelf: 27500,
      businessExpenseTotalSelf: 4500,
    })
  })

  it('配偶者側のキー（Honey / Darling 別の項目）を返り値に含めない', () => {
    const totals = selfTotalsOf(CommonMonthlyReportAttrsSchema.parse(common), 'honey')
    expect(Object.keys(totals).sort()).toEqual(['businessExpenseTotalSelf', 'personalTotalSelf'])
  })
})

describe('isIncompleteMonthReport', () => {
  const parsed = (isIncompleteMonth?: boolean) =>
    CommonMonthlyReportAttrsSchema.parse(
      isIncompleteMonth === undefined ? baseCommon : { ...baseCommon, isIncompleteMonth },
    )

  it('不完全月フラグが付いた月は不完全と判定する', () => {
    expect(isIncompleteMonthReport(parsed(true))).toBe(true)
  })

  it('フラグが未設定の月（通常の月）は不完全としない', () => {
    const common = parsed()
    expect(common.isIncompleteMonth).toBeUndefined()
    expect(isIncompleteMonthReport(common)).toBe(false)
  })

  it('フラグが明示的に false の月も不完全としない', () => {
    expect(isIncompleteMonthReport(parsed(false))).toBe(false)
  })
})
