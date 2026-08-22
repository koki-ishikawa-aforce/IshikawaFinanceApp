import { beforeEach, describe, expect, it } from 'vitest'
import { resolveMock } from '../resolve'
import {
  AccountBalanceListWireSchema,
  AssetTotalWireSchema,
  BalanceFreshnessListWireSchema,
  CurrentCycleResponseSchema,
  ExpenseSettlementViewWireSchema,
  OwnAccountListWireSchema,
} from '@/lib/api-schemas'

/** 画面の URL を差し替える（モックはクエリからロール・シナリオを読む） */
function visit(path: string) {
  window.history.replaceState({}, '', path)
}

const UNREGISTERED = '/?mockScenario=accounts-unregistered'

/** 任意登録（別銀行貯蓄・NISA）の口座種別 */
const OPTIONAL_KINDS = ['other_savings', 'nisa']

describe('resolveMock: 経費精算', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    visit('/expense-settlement')
  })

  it('精算画面のビューが画面のスキーマで読める', () => {
    const parsed = ExpenseSettlementViewWireSchema.parse(
      resolveMock('GET', '/api/expense-settlement?month=2026-07'),
    )
    expect(parsed.currentAccumulations.map(a => a.kind)).toEqual(['capped', 'unlimited'])
  })

  it('費用区分の累計が、上限までの計上額と按分子取引の金額に分かれている', () => {
    const view = ExpenseSettlementViewWireSchema.parse(
      resolveMock('GET', '/api/expense-settlement?month=2026-07'),
    )
    const capped = view.currentAccumulations.find(a => a.kind === 'capped')
    if (capped?.kind !== 'capped') throw new Error('上限つきの累計が無い')

    // 上限超過分は按分子取引へ回るため、累計は上限を超えない（超えていたら画面の
    // 進捗バーが 100% を超えた見た目になり、プレビューが実装の不具合に見える）
    const allocatedToExpense = capped.transactionRefs.reduce(
      (sum, ref) =>
        sum +
        (ref.allocation.kind === 'partial' ? ref.allocation.expenseAllocatedAmount : ref.amount),
      0,
    )
    expect(capped.currentTotal).toBe(allocatedToExpense)
    expect(capped.currentTotal).toBeLessThanOrEqual(capped.monthlyCap)

    const personalTotal = view.currentChildTransactions.reduce(
      (sum, c) => sum + c.personalAmount,
      0,
    )
    const excess = capped.transactionRefs.reduce(
      (sum, ref) =>
        sum + (ref.allocation.kind === 'partial' ? ref.allocation.personalAllocatedAmount : 0),
      0,
    )
    expect(personalTotal).toBe(excess)
  })

  it('サイクルは表示中の月のものを返す', () => {
    const parsed = CurrentCycleResponseSchema.parse(
      resolveMock('GET', '/api/expense-settlement/cycles?month=2026-05'),
    )
    expect(parsed.cycle?.common.targetYearMonth).toBe('2026-05')
  })
})

describe('resolveMock: 口座未登録シナリオ', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    visit('/')
  })

  it('既定では別銀行貯蓄口座・NISA 口座が登録済みで返る', () => {
    const accounts = OwnAccountListWireSchema.parse(resolveMock('GET', '/api/accounts'))
    expect(accounts.items.map(a => a.kind)).toEqual(expect.arrayContaining(OPTIONAL_KINDS))
  })

  it('口座未登録シナリオでは、任意登録の口座が口座一覧から消える', () => {
    visit(UNREGISTERED)
    const accounts = OwnAccountListWireSchema.parse(resolveMock('GET', '/api/accounts'))
    expect(accounts.items.map(a => a.kind)).not.toEqual(expect.arrayContaining(OPTIONAL_KINDS))
    expect(accounts.items.length).toBeGreaterThan(0)
  })

  it('口座未登録シナリオでは、残高一覧と鮮度からも同じ口座が消える', () => {
    visit(UNREGISTERED)
    const balances = AccountBalanceListWireSchema.parse(resolveMock('GET', '/api/balances'))
    expect(balances.items.map(b => b.kind)).not.toEqual(expect.arrayContaining(OPTIONAL_KINDS))

    // 鮮度の対象は手入力の別銀行貯蓄口座だけなので、未登録なら知らせるものが無い
    const freshness = BalanceFreshnessListWireSchema.parse(
      resolveMock('GET', '/api/dashboard/balance-freshness'),
    )
    expect(freshness.items).toEqual([])
  })

  it('資産合計は、どちらのシナリオでも内訳の合計と一致する', () => {
    for (const path of ['/', UNREGISTERED]) {
      visit(path)
      const total = AssetTotalWireSchema.parse(resolveMock('GET', '/api/balances/total'))
      expect(total.total).toBe(
        total.smbcBalance +
          total.otherSavingsBalance +
          total.nisaContributionAccumulated -
          total.cardUnpaidTotal,
      )
    }
  })
})
