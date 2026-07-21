import { describe, it, expect } from 'vitest'
import {
  MonthlyExpenseCycleSchema,
  calculateSettlementMatchDifference,
  confirmCycleCsv,
  cycleExpenseTotal,
  finalizeCycle,
  type AccumulatingCycle,
} from '../../../src/expense-settlement/aggregates/MonthlyExpenseCycle'
import { money } from '../../../src/shared/value-objects/Money'
import { testUlid } from '../../helpers/ids'

function cappedAccumulation(currentTotal: number, monthlyCap: number, refAmounts: number[]) {
  return {
    kind: 'capped',
    accumulationId: '01ACC000000000000000000001' as never,
    expenseTypeId: '01EXP000000000000000000001' as never,
    userId: 'user_honey' as never,
    monthlyCap: monthlyCap as never,
    currentTotal: currentTotal as never,
    capReached: { kind: 'not_reached' },
    transactionRefs: refAmounts.map((amount, i) => ({
      transactionId: testUlid('01TX', i) as never,
      occurredAt: new Date(),
      amount: amount as never,
      allocation: { kind: 'full' },
    })),
  }
}

function commonWith(accumulations: unknown[]) {
  return {
    monthlyExpenseCycleId: '01CYC000000000000000000001' as never,
    userId: 'user_honey' as never,
    targetYearMonth: '2026-07' as never,
    cycleStartedAt: new Date(),
    accumulations,
    childTransactionRefs: [],
  }
}

describe('MonthlyExpenseCycle 集約', () => {
  it('累計 ≤ 上限 かつ 累計 = Σ 経費充当分なら parse 成功', () => {
    expect(() =>
      MonthlyExpenseCycleSchema.parse({
        kind: 'accumulating',
        common: commonWith([cappedAccumulation(8000, 10000, [3000, 5000])]),
      }),
    ).not.toThrow()
  })

  it('累計が上限を超過すると parse 失敗', () => {
    expect(() =>
      MonthlyExpenseCycleSchema.parse({
        kind: 'accumulating',
        common: commonWith([cappedAccumulation(12000, 10000, [7000, 5000])]),
      }),
    ).toThrow()
  })

  it('累計 ≠ Σ 経費充当分なら parse 失敗', () => {
    expect(() =>
      MonthlyExpenseCycleSchema.parse({
        kind: 'accumulating',
        common: commonWith([cappedAccumulation(9000, 10000, [3000, 5000])]),
      }),
    ).toThrow()
  })

  it('部分経費充当は expenseAllocatedAmount のみ累計に含める', () => {
    const acc = {
      kind: 'capped',
      accumulationId: '01ACC000000000000000000001' as never,
      expenseTypeId: '01EXP000000000000000000001' as never,
      userId: 'user_honey' as never,
      monthlyCap: 10000 as never,
      currentTotal: 10000 as never,
      capReached: {
        kind: 'reached',
        reachedAt: new Date(),
        reachingTransactionId: '01TX0000000000000000000002' as never,
      },
      transactionRefs: [
        {
          transactionId: '01TX0000000000000000000001' as never,
          occurredAt: new Date(),
          amount: 7000 as never,
          allocation: { kind: 'full' },
        },
        {
          transactionId: '01TX0000000000000000000002' as never,
          occurredAt: new Date(),
          amount: 5000 as never,
          allocation: {
            kind: 'partial',
            expenseAllocatedAmount: 3000 as never,
            personalAllocatedAmount: 2000 as never,
            childTransactionId: '01CHD000000000000000000001' as never,
          },
        },
      ],
    }
    expect(() =>
      MonthlyExpenseCycleSchema.parse({ kind: 'accumulating', common: commonWith([acc]) }),
    ).not.toThrow()
  })

  it('最終確定サイクルは経費精算入金参照が必須（欠落で parse 失敗）', () => {
    expect(() =>
      MonthlyExpenseCycleSchema.parse({
        kind: 'finalized',
        common: commonWith([]),
        csvConfirmedAt: new Date(),
        finalizedAt: new Date(),
        unapprovedTransfers: [],
      }),
    ).toThrow()
  })

  it('confirmCycleCsv / finalizeCycle: 集積中 → CSV確定 → 最終確定の単方向遷移', () => {
    const accumulating = MonthlyExpenseCycleSchema.parse({
      kind: 'accumulating',
      common: commonWith([]),
    }) as AccumulatingCycle
    const confirmed = confirmCycleCsv(accumulating, new Date())
    expect(confirmed.kind).toBe('csv_confirmed')
    const finalized = finalizeCycle(
      confirmed,
      '01RMB000000000000000000001' as never,
      [],
      new Date(),
    )
    expect(finalized.kind).toBe('finalized')
    expect(finalized.expenseReimbursementId).toBe('01RMB000000000000000000001')
  })
})

describe('突合差額の算出（08e §2「経費精算入金と当月経費を突合する」）', () => {
  const cycle = MonthlyExpenseCycleSchema.parse({
    kind: 'csv_confirmed',
    common: commonWith([cappedAccumulation(8000, 10000, [3000, 5000])]),
    csvConfirmedAt: new Date(),
  })

  it('cycleExpenseTotal: 当月経費合計 = Σ 経費種別累計', () => {
    expect(cycleExpenseTotal(cycle)).toBe(8000)
  })

  it('入金額 < 当月経費合計 → 不認定分（unapproved_shortfall）', () => {
    expect(calculateSettlementMatchDifference(cycle, money(6500))).toEqual({
      kind: 'unapproved_shortfall',
      difference: 1500,
    })
  })

  it('入金額 > 当月経費合計 → 認定済み超過（approved_excess）', () => {
    expect(calculateSettlementMatchDifference(cycle, money(9000))).toEqual({
      kind: 'approved_excess',
      difference: 1000,
    })
  })

  it('入金額 = 当月経費合計 → 完全一致（exact_match）', () => {
    expect(calculateSettlementMatchDifference(cycle, money(8000))).toEqual({ kind: 'exact_match' })
  })
})
