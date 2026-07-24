import { describe, it, expect } from 'vitest'
import {
  finalizeExpenseSettlement,
  settleDepositForFinalizedCycle,
} from '../../../src/expense-settlement/services/finalizeExpenseSettlement'
import {
  MonthlyExpenseCycleSchema,
  finalizeCycle,
  type CsvConfirmedCycle,
  type FinalizedCycle,
} from '../../../src/expense-settlement/aggregates/MonthlyExpenseCycle'
import {
  ExpenseReimbursementDepositSchema,
  type AwaitingMatchDeposit,
} from '../../../src/expense-settlement/aggregates/ExpenseReimbursementDeposit'
import type { UnapprovedExpenseTransfer } from '../../../src/shared/value-objects/UnapprovedExpenseTransfer'
import {
  InvariantViolationError,
  PermissionDeniedError,
} from '../../../src/shared/errors/DomainError'
import { testUlid } from '../../helpers/ids'

const AT = new Date('2026-07-31T00:00:00Z')
const REIMBURSEMENT_ID = testUlid('01RMB', 1)

/** 経費合計 total 円の CSV確定サイクル */
function csvConfirmedCycle(total: number): CsvConfirmedCycle {
  return MonthlyExpenseCycleSchema.parse({
    kind: 'csv_confirmed',
    common: {
      monthlyExpenseCycleId: testUlid('01CYC', 1),
      userId: 'user_honey',
      targetYearMonth: '2026-07',
      cycleStartedAt: AT,
      accumulations: [
        {
          kind: 'capped',
          accumulationId: testUlid('01ACC', 1),
          expenseTypeId: testUlid('01EXP', 1),
          userId: 'user_honey',
          monthlyCap: total + 100000,
          currentTotal: total,
          capReached: { kind: 'not_reached' },
          transactionRefs: [
            {
              transactionId: testUlid('01TX', 1),
              occurredAt: AT,
              amount: total,
              allocation: { kind: 'full' },
            },
          ],
        },
      ],
      childTransactionRefs: [],
    },
    csvConfirmedAt: AT,
  }) as CsvConfirmedCycle
}

/** 突合待ち入金 */
function awaitingDeposit(depositAmount: number): AwaitingMatchDeposit {
  return ExpenseReimbursementDepositSchema.parse({
    kind: 'awaiting_match',
    common: {
      expenseReimbursementId: REIMBURSEMENT_ID,
      userId: 'user_honey',
      depositAmount,
      depositedAt: AT,
    },
    receivedAt: AT,
  }) as AwaitingMatchDeposit
}

function transfer(
  amount: number,
  target: 'personal_honey' | 'personal_darling',
): UnapprovedExpenseTransfer {
  return {
    originalBusinessExpenseTransactionId: testUlid('01TX', 9) as never,
    transferTarget: target,
    transferAmount: amount as never,
    transferredAt: AT,
  }
}

describe('finalizeExpenseSettlement（最終確定の不変条件）', () => {
  it('不認定分なし（入金 = 経費合計）: 振替なしで確定でき、入金は突合済みで止まる', () => {
    const result = finalizeExpenseSettlement(
      csvConfirmedCycle(8000),
      awaitingDeposit(8000),
      [],
      'personal_honey',
      AT,
    )
    expect(result.cycle.kind).toBe('finalized')
    expect(result.deposit.kind).toBe('matched')
    expect(result.cycle.expenseReimbursementId).toBe(REIMBURSEMENT_ID)
  })

  it('認定済み超過（入金 > 経費合計）: 振替なしで確定できる', () => {
    const result = finalizeExpenseSettlement(
      csvConfirmedCycle(3000),
      awaitingDeposit(5000),
      [],
      'personal_honey',
      AT,
    )
    expect(result.cycle.kind).toBe('finalized')
    expect(result.deposit.kind).toBe('matched')
  })

  it('不認定分あり + 振替合計 = 差額: 確定でき、入金は不認定分確定済みへ進む', () => {
    const result = finalizeExpenseSettlement(
      csvConfirmedCycle(10000),
      awaitingDeposit(5000), // 差額 5000
      [transfer(5000, 'personal_honey')],
      'personal_honey',
      AT,
    )
    expect(result.cycle.kind).toBe('finalized')
    expect(result.deposit.kind).toBe('unrecognized_confirmed')
    if (result.deposit.kind === 'unrecognized_confirmed') {
      expect(result.deposit.unapprovedTotal).toBe(5000)
    }
  })

  it('不認定分あり + 振替0件: 振替必須の不変条件で弾く（OQ-49 ①）', () => {
    expect(() =>
      finalizeExpenseSettlement(
        csvConfirmedCycle(10000),
        awaitingDeposit(5000),
        [],
        'personal_honey',
        AT,
      ),
    ).toThrow(InvariantViolationError)
  })

  it('不認定分あり + 振替合計 ≠ 差額: 一致しないと弾く', () => {
    expect(() =>
      finalizeExpenseSettlement(
        csvConfirmedCycle(10000),
        awaitingDeposit(5000),
        [transfer(3000, 'personal_honey')],
        'personal_honey',
        AT,
      ),
    ).toThrow(InvariantViolationError)
  })

  it('振替先が本人の個人費用区分でない: PermissionDenied で弾く', () => {
    expect(() =>
      finalizeExpenseSettlement(
        csvConfirmedCycle(10000),
        awaitingDeposit(5000),
        [transfer(5000, 'personal_darling')],
        'personal_honey',
        AT,
      ),
    ).toThrow(PermissionDeniedError)
  })

  it('不認定分なしなのに振替を指定: 弾く', () => {
    expect(() =>
      finalizeExpenseSettlement(
        csvConfirmedCycle(3000),
        awaitingDeposit(5000),
        [transfer(100, 'personal_honey')],
        'personal_honey',
        AT,
      ),
    ).toThrow(InvariantViolationError)
  })
})

describe('settleDepositForFinalizedCycle（復旧パスの終端遷移）', () => {
  function finalizedCycle(total: number, transfers: UnapprovedExpenseTransfer[]): FinalizedCycle {
    return finalizeCycle(csvConfirmedCycle(total), REIMBURSEMENT_ID as never, transfers, AT)
  }

  it('振替を伴う確定サイクル + 不認定分あり: 入金を不認定分確定済みへ進める', () => {
    const settled = settleDepositForFinalizedCycle(
      finalizedCycle(10000, [transfer(5000, 'personal_honey')]),
      awaitingDeposit(5000),
      AT,
    )
    expect(settled.kind).toBe('unrecognized_confirmed')
  })

  it('振替のない確定サイクル: 入金は突合済みで止める', () => {
    const settled = settleDepositForFinalizedCycle(
      finalizedCycle(8000, []),
      awaitingDeposit(8000),
      AT,
    )
    expect(settled.kind).toBe('matched')
  })
})
