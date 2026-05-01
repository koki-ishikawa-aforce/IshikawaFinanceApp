import { describe, it, expect } from 'vitest'
import {
  MonthlyReportSchema,
  finalize,
  type CsvConfirmedReport,
} from '../../../src/household-analysis/aggregates/MonthlyReport'

const baseCommon = {
  monthlyReportId: 'rep_001' as never,
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
        expenseReimbursementId: 'reimb_001' as never,
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
      'reimb_001' as never,
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

    expect(() =>
      finalize(csvConfirmed, '' as never, new Date(), [], new Date()),
    ).toThrow()
  })
})
