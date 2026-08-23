import { beforeEach, describe, expect, it } from 'vitest'
import { resolveMock } from '../resolve'
import { DashboardKpisViewSchema } from '@warimaru/domain'
import {
  AccountBalanceListWireSchema,
  AssetTotalWireSchema,
  BalanceFreshnessListWireSchema,
  BalanceTimeSeriesWireSchema,
  CurrentCycleResponseSchema,
  ExpenseSettlementViewWireSchema,
  OwnAccountListWireSchema,
} from '@/lib/api-schemas'

/** 画面の URL を差し替える（モックはクエリからロール・シナリオを読む） */
function visit(path: string) {
  window.history.replaceState({}, '', path)
}

const UNREGISTERED = '/?mockScenario=accounts-unregistered'

/** 三井住友系（自動管理）の口座種別。どのシナリオでも必ず残る */
const AUTOMANAGED_KINDS = ['smbc_bank', 'mitsui_sumitomo_card']

describe('resolveMock: 経費精算', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    visit('/expense-settlement')
  })

  it('経費種別ごとの累計を、上限つき（上限到達）と上限なしの両方で返す', () => {
    const view = ExpenseSettlementViewWireSchema.parse(
      resolveMock('GET', '/api/expense-settlement?month=2026-07'),
    )
    const [capped, unlimited] = view.currentAccumulations
    if (capped?.kind !== 'capped') throw new Error('上限つきの累計が無い')
    if (unlimited?.kind !== 'unlimited') throw new Error('上限なしの累計が無い')

    // 「上限到達」の見た目を写すために撮っている画面なので、その状態を固定する
    expect(capped.monthlyCap).toBe(30000)
    expect(capped.currentTotal).toBe(30000)
    expect(capped.capReached.kind).toBe('reached')
    expect(unlimited.currentTotal).toBe(7920)
  })

  it('上限を超えた取引が、経費に計上する額と個人が負担する額に分かれている', () => {
    const view = ExpenseSettlementViewWireSchema.parse(
      resolveMock('GET', '/api/expense-settlement?month=2026-07'),
    )
    const capped = view.currentAccumulations.find(a => a.kind === 'capped')
    if (capped?.kind !== 'capped') throw new Error('上限つきの累計が無い')
    const split = capped.transactionRefs.find(ref => ref.allocation.kind === 'partial')
    if (split?.allocation.kind !== 'partial') throw new Error('上限を跨いだ取引が無い')

    // 取引の金額と内訳が合っていないと、画面に足し算の合わない行が出る
    expect(split.allocation.expenseAllocatedAmount + split.allocation.personalAllocatedAmount).toBe(
      split.amount,
    )
    // 経費に計上できるのは上限までの残りぶん。個人が負担するのは超過ぶん
    expect(split.allocation.expenseAllocatedAmount).toBe(9200)
    expect(split.allocation.personalAllocatedAmount).toBe(3200)
    expect(capped.currentTotal).toBe(20800 + split.allocation.expenseAllocatedAmount)

    const child = view.currentChildTransactions[0]
    expect(view.currentChildTransactions).toHaveLength(1)
    expect(child?.parentTransactionId).toBe(split.transactionId)
    expect(child?.personalAmount).toBe(split.allocation.personalAllocatedAmount)
  })

  it('閲覧ロールが honey なら、按分先も honey の個人になる', () => {
    visit('/expense-settlement?mockRole=honey')
    const view = ExpenseSettlementViewWireSchema.parse(
      resolveMock('GET', '/api/expense-settlement?month=2026-07'),
    )
    expect(view.userId).toBe('U_HONEY_MOCK')
    expect(view.currentChildTransactions[0]?.personalExpenseClass).toBe('personal_honey')
  })

  it('直近の確定サイクルは表示中の月の前月で、同じ月が二重に現れない', () => {
    const view = ExpenseSettlementViewWireSchema.parse(
      resolveMock('GET', '/api/expense-settlement?month=2026-01'),
    )
    // 年を跨いでも前月になる（当月が集積中なのに同じ月が確定済み、という並びを作らない）
    expect(view.latestFinalizedCycle?.targetYearMonth).toBe('2025-12')

    const cycle = CurrentCycleResponseSchema.parse(
      resolveMock('GET', '/api/expense-settlement/cycles?month=2026-01'),
    )
    expect(cycle.cycle?.common.targetYearMonth).toBe('2026-01')
  })

  it('サイクルは表示中の月の月初に始まった集積中のものを返す', () => {
    const parsed = CurrentCycleResponseSchema.parse(
      resolveMock('GET', '/api/expense-settlement/cycles?month=2026-05'),
    )
    // 集積中でないと「按分子取引を生成」「CSV 確定」が出ず、画面のほとんどが写らない
    expect(parsed.cycle?.kind).toBe('accumulating')
    expect(parsed.cycle?.common.targetYearMonth).toBe('2026-05')
    expect(parsed.cycle?.common.cycleStartedAt).toEqual(new Date('2026-05-01T00:00:00.000Z'))
  })

  it('月指定が壊れていても画面を落とさず既定の月で返す', () => {
    const parsed = CurrentCycleResponseSchema.parse(
      resolveMock('GET', '/api/expense-settlement/cycles?month=2026-13'),
    )
    expect(parsed.cycle?.common.targetYearMonth).toBe('2026-07')
  })
})

describe('resolveMock: 口座未登録シナリオ', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    visit('/')
  })

  it('既定ではシャドウ口座（別銀行貯蓄・NISA）まで登録済みで返る', () => {
    const accounts = OwnAccountListWireSchema.parse(resolveMock('GET', '/api/accounts'))
    expect(accounts.items.map(a => a.kind)).toEqual([...AUTOMANAGED_KINDS, 'other_savings', 'nisa'])
  })

  it('口座未登録シナリオでは、シャドウ口座が口座一覧から消える', () => {
    visit(UNREGISTERED)
    const accounts = OwnAccountListWireSchema.parse(resolveMock('GET', '/api/accounts'))
    // 片方だけ消し忘れても落ちるよう、残る種別を集合ごと固定する
    expect(accounts.items.map(a => a.kind)).toEqual(AUTOMANAGED_KINDS)
  })

  it('口座一覧の所有者は閲覧ロール本人になる', () => {
    visit('/?mockRole=honey')
    const accounts = OwnAccountListWireSchema.parse(resolveMock('GET', '/api/accounts'))
    expect(accounts.items.map(a => a.common.ownerUserId)).toEqual(
      accounts.items.map(() => 'U_HONEY_MOCK'),
    )
  })

  it('口座未登録シナリオでは、残高一覧と鮮度の知らせからも同じ口座が消える', () => {
    visit(UNREGISTERED)
    const balances = AccountBalanceListWireSchema.parse(resolveMock('GET', '/api/balances'))
    expect(balances.items.map(b => b.kind)).toEqual(AUTOMANAGED_KINDS)

    // 鮮度の対象は手入力の別銀行貯蓄口座だけなので、未登録なら知らせるものが無い
    const freshness = BalanceFreshnessListWireSchema.parse(
      resolveMock('GET', '/api/dashboard/balance-freshness'),
    )
    expect(freshness.items).toEqual([])
  })

  it('資産合計の内訳は、既定では登録済みの残高、口座未登録では 0 になる', () => {
    const registered = AssetTotalWireSchema.parse(resolveMock('GET', '/api/balances/total'))
    expect(registered.smbcBalance).toBe(1500000)
    expect(registered.otherSavingsBalance).toBe(2000000)
    expect(registered.nisaContributionAccumulated).toBe(1200000)
    expect(registered.cardUnpaidTotal).toBe(120000)
    expect(registered.total).toBe(4580000)

    visit(UNREGISTERED)
    const unregistered = AssetTotalWireSchema.parse(resolveMock('GET', '/api/balances/total'))
    expect(unregistered.smbcBalance).toBe(1500000)
    expect(unregistered.otherSavingsBalance).toBe(0)
    expect(unregistered.nisaContributionAccumulated).toBe(0)
    expect(unregistered.total).toBe(1380000)
  })

  it('資産合計の貯蓄・NISA は、残高一覧の本人分と相手の合計を足した額と一致する', () => {
    // 一覧は本人の口座だけになり、相手の分は合計 1 件にまとまる（P2-B5 / AT-404）。
    // 世帯の資産合計は据え置きのため、本人分 + 相手の合計が内訳と一致していないと
    // プレビューの画面同士で数字が食い違う
    const balances = AccountBalanceListWireSchema.parse(resolveMock('GET', '/api/balances'))
    const listed = balances.items.reduce((sum, item) => {
      if (item.kind === 'other_savings') return sum + item.currentBalance
      if (item.kind === 'nisa') return sum + item.currentAccumulated
      return sum
    }, 0)
    const total = AssetTotalWireSchema.parse(resolveMock('GET', '/api/balances/total'))
    expect(listed + (balances.spouseOtherSavingsAndNisaTotal ?? 0)).toBe(
      total.otherSavingsBalance + total.nisaContributionAccumulated,
    )
  })

  it('ダッシュボードの資産額は、残高画面と同じ値になる', () => {
    const registered = DashboardKpisViewSchema.parse(resolveMock('GET', '/api/dashboard/kpis'))
    expect(registered.savingsBalance).toBe(3500000)
    expect(registered.nisaContributionAccumulated).toBe(1200000)
    expect(registered.totalAssets).toBe(4580000)

    visit(UNREGISTERED)
    const unregistered = DashboardKpisViewSchema.parse(resolveMock('GET', '/api/dashboard/kpis'))
    expect(unregistered.savingsBalance).toBe(1500000)
    expect(unregistered.nisaContributionAccumulated).toBe(0)
    expect(unregistered.totalAssets).toBe(1380000)
  })

  it('口座未登録シナリオでは、資産推移から貯蓄と NISA の線が消える', () => {
    visit(UNREGISTERED)
    const series = BalanceTimeSeriesWireSchema.parse(
      resolveMock('GET', '/api/balances/time-series'),
    )
    // 0 の系列を返すと「0 円で推移した」に読めるため、線ごと無くす
    expect(series.otherSavings).toEqual([])
    expect(series.nisaContribution).toEqual([])
    // 自動管理の口座は未登録シナリオでも残る（推移がまるごと空にならない）
    expect(series.smbc.length).toBeGreaterThan(0)
    expect(series.cardUnpaid.length).toBeGreaterThan(0)
  })
})
