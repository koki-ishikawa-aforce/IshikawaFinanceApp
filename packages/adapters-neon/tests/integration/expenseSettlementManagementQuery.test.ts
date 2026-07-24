import { describe, it, expect } from 'vitest'
import { canViewExpenseSettlement, ExpenseSettlementManagementViewSchema } from '@warimaru/domain'
import { db } from './setup'
import { NeonMonthlyExpenseCycleRepository } from '../../src/expense-settlement/NeonMonthlyExpenseCycleRepository'
import { NeonProratedChildTransactionRepository } from '../../src/expense-settlement/NeonProratedChildTransactionRepository'
import { NeonExpenseSettlementManagementQuery } from '../../src/expense-settlement/NeonExpenseSettlementManagementQuery'
import { newUlid } from '../../src/newId'
import { DARLING_USER_ID, HONEY_USER_ID, ym } from '../helpers/fixtures'
import {
  accumulatingCycle,
  capReachedAccumulation,
  finalizedCycle,
  proratedChild,
} from '../helpers/expenseSettlementFixtures'

const cycleRepo = new NeonMonthlyExpenseCycleRepository(db)
const childRepo = new NeonProratedChildTransactionRepository(db)
// UTC 2026-07-07 00:00 = JST 2026-07-07 09:00 → 当月 = 2026-07
const NOW = new Date('2026-07-07T00:00:00.000Z')
const query = new NeonExpenseSettlementManagementQuery(db, { now: () => NOW })

describe('NeonExpenseSettlementManagementQuery', () => {
  it('当月サイクルの累計 + 按分子取引 + 直近最終確定サマリを合成する', async () => {
    const childId = newUlid()
    const child = proratedChild({ userId: HONEY_USER_ID, childTransactionId: childId })
    await childRepo.save(child)
    const current = accumulatingCycle({
      userId: HONEY_USER_ID,
      targetYearMonth: ym('2026-07'),
      accumulations: [
        capReachedAccumulation({ userId: HONEY_USER_ID, childTransactionId: childId }),
      ],
      childTransactionIds: [childId],
    })
    await cycleRepo.save(current)
    const finalized = finalizedCycle({
      userId: HONEY_USER_ID,
      targetYearMonth: ym('2026-06'),
      transferAmounts: [1500, 800],
    })
    await cycleRepo.save(finalized)

    const view = await query.fetch(HONEY_USER_ID)
    expect(view.userId).toBe(HONEY_USER_ID)
    expect(view.currentAccumulations).toEqual(current.common.accumulations)
    expect(view.currentChildTransactions).toEqual([child])
    expect(view.latestFinalizedCycle).toEqual({
      monthlyExpenseCycleId: finalized.common.monthlyExpenseCycleId,
      targetYearMonth: ym('2026-06'),
      finalizedAt: finalized.kind === 'finalized' ? finalized.finalizedAt : new Date(),
      unapprovedTotal: 2300,
    })
  })

  it('最終確定が複数あれば対象年月が最新の 1 件をサマリにする', async () => {
    await cycleRepo.save(
      finalizedCycle({
        userId: HONEY_USER_ID,
        targetYearMonth: ym('2026-04'),
        transferAmounts: [100],
      }),
    )
    const latest = finalizedCycle({
      userId: HONEY_USER_ID,
      targetYearMonth: ym('2026-05'),
      transferAmounts: [200],
    })
    await cycleRepo.save(latest)

    const view = await query.fetch(HONEY_USER_ID)
    expect(view.latestFinalizedCycle?.targetYearMonth).toBe(ym('2026-05'))
    expect(view.latestFinalizedCycle?.unapprovedTotal).toBe(200)
  })

  it('targetMonth 指定で過去月のサイクルの累計・按分子取引を返す', async () => {
    const childId = newUlid()
    const child = proratedChild({ userId: HONEY_USER_ID, childTransactionId: childId })
    await childRepo.save(child)
    const past = finalizedCycle({
      userId: HONEY_USER_ID,
      targetYearMonth: ym('2026-05'),
      transferAmounts: [300],
      accumulations: [
        capReachedAccumulation({ userId: HONEY_USER_ID, childTransactionId: childId }),
      ],
      childTransactionIds: [childId],
    })
    await cycleRepo.save(past)
    await cycleRepo.save(
      accumulatingCycle({ userId: HONEY_USER_ID, targetYearMonth: ym('2026-07') }),
    )

    const view = await query.fetch(HONEY_USER_ID, ym('2026-05'))
    expect(view.currentAccumulations).toEqual(past.common.accumulations)
    expect(view.currentChildTransactions).toEqual([child])
    // latestFinalizedCycle は targetMonth に依らず直近の最終確定
    expect(view.latestFinalizedCycle?.targetYearMonth).toBe(ym('2026-05'))
  })

  it('論点11: 配偶者のデータは混入しない（配偶者のサイクルしかない月は空 view）', async () => {
    await cycleRepo.save(
      accumulatingCycle({ userId: DARLING_USER_ID, targetYearMonth: ym('2026-07') }),
    )
    await cycleRepo.save(
      finalizedCycle({ userId: DARLING_USER_ID, targetYearMonth: ym('2026-06') }),
    )

    const view = await query.fetch(HONEY_USER_ID)
    // 空でも view.userId = viewerId（canViewExpenseSettlement ガードを通過する構造）
    expect(view).toEqual({
      userId: HONEY_USER_ID,
      currentAccumulations: [],
      currentChildTransactions: [],
      latestFinalizedCycle: null,
    })
  })

  it('ガード分岐: viewer と view.userId の不一致は canViewExpenseSettlement が拒否する', () => {
    // fetch は viewerId 起点で view を組むため構造上 false にならないが、
    // adapter が返却前に必ず通す判定ポイント自体の挙動をここで固定する
    const foreignView = ExpenseSettlementManagementViewSchema.parse({
      userId: DARLING_USER_ID,
      currentAccumulations: [],
      currentChildTransactions: [],
      latestFinalizedCycle: null,
    })
    expect(canViewExpenseSettlement(foreignView, HONEY_USER_ID)).toBe(false)
    expect(canViewExpenseSettlement(foreignView, DARLING_USER_ID)).toBe(true)
  })
})

describe('NeonExpenseSettlementManagementQuery プライバシー否定形テスト', () => {
  it('両ユーザーにデータがある場合、配偶者のサイクル・累計・按分子取引は混入しない', async () => {
    const honeyChildId = newUlid()
    const darlingChildId = newUlid()
    const honeyChild = proratedChild({ userId: HONEY_USER_ID, childTransactionId: honeyChildId })
    const darlingChild = proratedChild({
      userId: DARLING_USER_ID,
      childTransactionId: darlingChildId,
    })
    await childRepo.save(honeyChild)
    await childRepo.save(darlingChild)

    const honeyCycle = accumulatingCycle({
      userId: HONEY_USER_ID,
      targetYearMonth: ym('2026-07'),
      accumulations: [
        capReachedAccumulation({ userId: HONEY_USER_ID, childTransactionId: honeyChildId }),
      ],
      childTransactionIds: [honeyChildId],
    })
    const darlingCycle = accumulatingCycle({
      userId: DARLING_USER_ID,
      targetYearMonth: ym('2026-07'),
      accumulations: [
        capReachedAccumulation({ userId: DARLING_USER_ID, childTransactionId: darlingChildId }),
      ],
      childTransactionIds: [darlingChildId],
    })
    await cycleRepo.save(honeyCycle)
    await cycleRepo.save(darlingCycle)

    const honeyFinalized = finalizedCycle({
      userId: HONEY_USER_ID,
      targetYearMonth: ym('2026-06'),
      transferAmounts: [1500],
    })
    const darlingFinalized = finalizedCycle({
      userId: DARLING_USER_ID,
      targetYearMonth: ym('2026-06'),
      transferAmounts: [9999],
    })
    await cycleRepo.save(honeyFinalized)
    await cycleRepo.save(darlingFinalized)

    const honeyView = await query.fetch(HONEY_USER_ID)
    expect(honeyView.userId).toBe(HONEY_USER_ID)
    expect(honeyView.currentAccumulations).toEqual(honeyCycle.common.accumulations)
    expect(honeyView.currentChildTransactions).toEqual([honeyChild])
    expect(honeyView.currentChildTransactions).not.toContainEqual(darlingChild)
    expect(honeyView.latestFinalizedCycle?.unapprovedTotal).toBe(1500)
    expect(honeyView.latestFinalizedCycle?.unapprovedTotal).not.toBe(9999)

    const darlingView = await query.fetch(DARLING_USER_ID)
    expect(darlingView.userId).toBe(DARLING_USER_ID)
    expect(darlingView.currentAccumulations).toEqual(darlingCycle.common.accumulations)
    expect(darlingView.currentChildTransactions).toEqual([darlingChild])
    expect(darlingView.currentChildTransactions).not.toContainEqual(honeyChild)
    expect(darlingView.latestFinalizedCycle?.unapprovedTotal).toBe(9999)
    expect(darlingView.latestFinalizedCycle?.unapprovedTotal).not.toBe(1500)
  })
})
