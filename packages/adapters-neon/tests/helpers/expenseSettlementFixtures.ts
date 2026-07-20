/**
 * 経費精算コンテキストのテストフィクスチャ
 *
 * MonthlyExpenseCycle の superRefine（累計 = Σ経費充当分、上限以内）を満たすよう
 * 累計とその transactionRefs を整合させて生成する。
 */
import type {
  ExpenseReimbursementDeposit,
  ExpenseTypeAccumulation,
  MonthlyExpenseCycle,
  ProratedChildTransaction,
  UserId,
  YearMonth,
} from '@warimaru/domain'
import {
  ExpenseReimbursementDepositSchema,
  ExpenseTypeAccumulationSchema,
  MonthlyExpenseCycleSchema,
  ProratedChildTransactionSchema,
} from '@warimaru/domain'
import { newUlid } from '../../src/newId'
import { HONEY_USER_ID, ym } from './fixtures'

/** 上限あり累計（全額充当 3,000 円 1 件、上限 10,000 円） */
export function cappedAccumulation(input: { userId?: UserId } = {}): ExpenseTypeAccumulation {
  return ExpenseTypeAccumulationSchema.parse({
    kind: 'capped',
    accumulationId: newUlid(),
    expenseTypeId: newUlid(),
    userId: input.userId ?? HONEY_USER_ID,
    monthlyCap: 10000,
    currentTotal: 3000,
    capReached: { kind: 'not_reached' },
    transactionRefs: [
      {
        transactionId: newUlid(),
        occurredAt: new Date('2026-07-02T03:00:00.000Z'),
        amount: 3000,
        allocation: { kind: 'full' },
      },
    ],
  })
}

/** 部分充当を含む上限あり累計（8,000 + 部分 2,000 = 上限 10,000 到達） */
export function capReachedAccumulation(input: {
  userId?: UserId
  childTransactionId: string
}): ExpenseTypeAccumulation {
  const reachingTransactionId = newUlid()
  return ExpenseTypeAccumulationSchema.parse({
    kind: 'capped',
    accumulationId: newUlid(),
    expenseTypeId: newUlid(),
    userId: input.userId ?? HONEY_USER_ID,
    monthlyCap: 10000,
    currentTotal: 10000,
    capReached: {
      kind: 'reached',
      reachedAt: new Date('2026-07-03T03:00:00.000Z'),
      reachingTransactionId,
    },
    transactionRefs: [
      {
        transactionId: newUlid(),
        occurredAt: new Date('2026-07-01T03:00:00.000Z'),
        amount: 8000,
        allocation: { kind: 'full' },
      },
      {
        transactionId: reachingTransactionId,
        occurredAt: new Date('2026-07-03T03:00:00.000Z'),
        amount: 5000,
        allocation: {
          kind: 'partial',
          expenseAllocatedAmount: 2000,
          personalAllocatedAmount: 3000,
          childTransactionId: input.childTransactionId,
        },
      },
    ],
  })
}

export function accumulatingCycle(
  input: {
    userId?: UserId
    targetYearMonth?: YearMonth
    accumulations?: ExpenseTypeAccumulation[]
    childTransactionIds?: string[]
  } = {},
): MonthlyExpenseCycle {
  const userId = input.userId ?? HONEY_USER_ID
  return MonthlyExpenseCycleSchema.parse({
    kind: 'accumulating',
    common: {
      monthlyExpenseCycleId: newUlid(),
      userId,
      targetYearMonth: input.targetYearMonth ?? ym('2026-07'),
      cycleStartedAt: new Date('2026-06-30T15:00:00.000Z'),
      accumulations: input.accumulations ?? [cappedAccumulation({ userId })],
      childTransactionRefs: (input.childTransactionIds ?? []).map(childTransactionId => ({
        childTransactionId,
        parentTransactionId: newUlid(),
      })),
    },
  })
}

export function finalizedCycle(
  input: { userId?: UserId; targetYearMonth?: YearMonth; transferAmounts?: number[] } = {},
): MonthlyExpenseCycle {
  const base = accumulatingCycle(input)
  return MonthlyExpenseCycleSchema.parse({
    kind: 'finalized',
    common: base.common,
    csvConfirmedAt: new Date('2026-07-01T01:00:00.000Z'),
    finalizedAt: new Date('2026-07-03T01:00:00.000Z'),
    expenseReimbursementId: newUlid(),
    unapprovedTransfers: (input.transferAmounts ?? [1500]).map(transferAmount => ({
      originalBusinessExpenseTransactionId: newUlid(),
      transferTarget: 'personal_honey' as const,
      transferAmount,
      transferredAt: new Date('2026-07-03T00:30:00.000Z'),
    })),
  })
}

export function proratedChild(
  input: { userId?: UserId; childTransactionId?: string; parentTransactionId?: string } = {},
): ProratedChildTransaction {
  return ProratedChildTransactionSchema.parse({
    childTransactionId: input.childTransactionId ?? newUlid(),
    parentTransactionId: input.parentTransactionId ?? newUlid(),
    userId: input.userId ?? HONEY_USER_ID,
    personalAmount: 3000,
    personalExpenseClass: 'personal_honey',
    derivedAt: new Date('2026-07-03T03:30:00.000Z'),
    prorationBasis: {
      kind: 'cap_excess_fifo',
      monthlyExpenseCycleId: newUlid(),
      proratedAt: new Date('2026-07-03T03:30:00.000Z'),
      capRemainderAtExcess: 2000,
    },
  })
}

export function awaitingDeposit(input: { userId?: UserId } = {}): ExpenseReimbursementDeposit {
  return ExpenseReimbursementDepositSchema.parse({
    kind: 'awaiting_match',
    common: {
      expenseReimbursementId: newUlid(),
      userId: input.userId ?? HONEY_USER_ID,
      depositAmount: 12000,
      depositedAt: new Date('2026-07-25T01:00:00.000Z'),
    },
    receivedAt: new Date('2026-07-25T02:00:00.000Z'),
  })
}

export function matchedDeposit(input: { userId?: UserId } = {}): ExpenseReimbursementDeposit {
  const base = awaitingDeposit(input)
  return ExpenseReimbursementDepositSchema.parse({
    kind: 'matched',
    common: base.common,
    matchedAt: new Date('2026-07-26T01:00:00.000Z'),
    matchedCycleId: newUlid(),
  })
}

export function unrecognizedConfirmedDeposit(
  input: { userId?: UserId } = {},
): ExpenseReimbursementDeposit {
  const base = matchedDeposit(input)
  if (base.kind !== 'matched') throw new Error('unreachable')
  return ExpenseReimbursementDepositSchema.parse({
    kind: 'unrecognized_confirmed',
    common: base.common,
    matchedAt: base.matchedAt,
    matchedCycleId: base.matchedCycleId,
    unapprovedTotal: 1500,
    transferConfirmedAt: new Date('2026-07-27T01:00:00.000Z'),
  })
}
