import { describe, it, expect } from 'vitest'
import { recalculateAccumulationForCapChange } from '../../../src/expense-settlement/services/recalculateForCapChange'
import { ExpenseTypeAccumulationSchema } from '../../../src/expense-settlement/value-objects/ExpenseTypeAccumulation'
import type { ExpenseTypeAccumulation } from '../../../src/expense-settlement/value-objects/ExpenseTypeAccumulation'
import type { Money } from '../../../src/shared/value-objects/Money'
import type { ChildTransactionId } from '../../../src/shared/ids'
import { testUlid } from '../../helpers/ids'

const ACC_ID = testUlid('01ACC', 1)
const EXPENSE_TYPE_ID = testUlid('01EXP', 1)
const USER_ID = 'user_honey'
const TX1_ID = testUlid('01TX', 1)
const TX2_ID = testUlid('01TX', 2)
const TX3_ID = testUlid('01TX', 3)
const CHILD1_ID = testUlid('01CH', 1)

const T1 = new Date('2026-07-01T10:00:00Z')
const T2 = new Date('2026-07-05T10:00:00Z')
const T3 = new Date('2026-07-10T10:00:00Z')

let childIdCounter = 100
function generateChildId(): ChildTransactionId {
  return testUlid('01CH', ++childIdCounter) as unknown as ChildTransactionId
}

function cappedAccumulation(
  monthlyCap: number,
  txRefs: Array<{
    transactionId: string
    occurredAt: Date
    amount: number
    allocation:
      | { kind: 'full' }
      | {
          kind: 'partial'
          expenseAllocatedAmount: number
          personalAllocatedAmount: number
          childTransactionId: string
        }
  }>,
): ExpenseTypeAccumulation {
  const currentTotal = txRefs.reduce((sum, ref) => {
    if (ref.allocation.kind === 'full') return sum + ref.amount
    return sum + ref.allocation.expenseAllocatedAmount
  }, 0)
  return ExpenseTypeAccumulationSchema.parse({
    kind: 'capped',
    accumulationId: ACC_ID,
    expenseTypeId: EXPENSE_TYPE_ID,
    userId: USER_ID,
    monthlyCap,
    currentTotal,
    capReached: { kind: 'not_reached' },
    transactionRefs: txRefs,
  })
}

function unlimitedAccumulation(
  txRefs: Array<{
    transactionId: string
    occurredAt: Date
    amount: number
    allocation: { kind: 'full' }
  }>,
): ExpenseTypeAccumulation {
  const currentTotal = txRefs.reduce((sum, ref) => sum + ref.amount, 0)
  return ExpenseTypeAccumulationSchema.parse({
    kind: 'unlimited',
    accumulationId: ACC_ID,
    expenseTypeId: EXPENSE_TYPE_ID,
    userId: USER_ID,
    currentTotal,
    transactionRefs: txRefs,
  })
}

describe('recalculateAccumulationForCapChange', () => {
  it('上限引き上げ: partial が full に戻る', () => {
    const acc = cappedAccumulation(5000, [
      { transactionId: TX1_ID, occurredAt: T1, amount: 3000, allocation: { kind: 'full' } },
      {
        transactionId: TX2_ID,
        occurredAt: T2,
        amount: 4000,
        allocation: {
          kind: 'partial',
          expenseAllocatedAmount: 2000,
          personalAllocatedAmount: 2000,
          childTransactionId: CHILD1_ID,
        },
      },
    ])

    const result = recalculateAccumulationForCapChange(acc, 10000 as Money, generateChildId)

    expect(result.kind).toBe('capped')
    if (result.kind !== 'capped') return
    expect(result.monthlyCap).toBe(10000)
    expect(result.currentTotal).toBe(7000)
    expect(result.transactionRefs[0]?.allocation.kind).toBe('full')
    expect(result.transactionRefs[1]?.allocation.kind).toBe('full')
    expect(result.capReached.kind).toBe('not_reached')
  })

  it('上限引き下げ: full が partial になる', () => {
    const acc = cappedAccumulation(10000, [
      { transactionId: TX1_ID, occurredAt: T1, amount: 3000, allocation: { kind: 'full' } },
      { transactionId: TX2_ID, occurredAt: T2, amount: 4000, allocation: { kind: 'full' } },
      { transactionId: TX3_ID, occurredAt: T3, amount: 5000, allocation: { kind: 'full' } },
    ])

    const result = recalculateAccumulationForCapChange(acc, 5000 as Money, generateChildId)

    expect(result.kind).toBe('capped')
    if (result.kind !== 'capped') return
    expect(result.monthlyCap).toBe(5000)
    expect(result.currentTotal).toBe(5000)
    expect(result.transactionRefs[0]?.allocation.kind).toBe('full')
    const tx2Alloc = result.transactionRefs[1]?.allocation
    expect(tx2Alloc?.kind).toBe('partial')
    if (tx2Alloc?.kind !== 'partial') return
    expect(tx2Alloc.expenseAllocatedAmount).toBe(2000)
    expect(tx2Alloc.personalAllocatedAmount).toBe(2000)
    const tx3Alloc = result.transactionRefs[2]?.allocation
    expect(tx3Alloc?.kind).toBe('partial')
    if (tx3Alloc?.kind !== 'partial') return
    expect(tx3Alloc.expenseAllocatedAmount).toBe(0)
    expect(tx3Alloc.personalAllocatedAmount).toBe(5000)
  })

  it('capped → unlimited: 全取引が full になる', () => {
    const acc = cappedAccumulation(5000, [
      { transactionId: TX1_ID, occurredAt: T1, amount: 3000, allocation: { kind: 'full' } },
      {
        transactionId: TX2_ID,
        occurredAt: T2,
        amount: 4000,
        allocation: {
          kind: 'partial',
          expenseAllocatedAmount: 2000,
          personalAllocatedAmount: 2000,
          childTransactionId: CHILD1_ID,
        },
      },
    ])

    const result = recalculateAccumulationForCapChange(acc, null, generateChildId)

    expect(result.kind).toBe('unlimited')
    expect(result.currentTotal).toBe(7000)
    expect(result.transactionRefs[0]?.allocation.kind).toBe('full')
    expect(result.transactionRefs[1]?.allocation.kind).toBe('full')
  })

  it('unlimited → capped: FIFO で上限超過を按分する', () => {
    const acc = unlimitedAccumulation([
      { transactionId: TX1_ID, occurredAt: T1, amount: 3000, allocation: { kind: 'full' } },
      { transactionId: TX2_ID, occurredAt: T2, amount: 4000, allocation: { kind: 'full' } },
    ])

    const result = recalculateAccumulationForCapChange(acc, 5000 as Money, generateChildId)

    expect(result.kind).toBe('capped')
    if (result.kind !== 'capped') return
    expect(result.monthlyCap).toBe(5000)
    expect(result.currentTotal).toBe(5000)
    expect(result.transactionRefs[0]?.allocation.kind).toBe('full')
    const tx2Alloc = result.transactionRefs[1]?.allocation
    expect(tx2Alloc?.kind).toBe('partial')
    if (tx2Alloc?.kind !== 'partial') return
    expect(tx2Alloc.expenseAllocatedAmount).toBe(2000)
    expect(tx2Alloc.personalAllocatedAmount).toBe(2000)
  })

  it('取引なしの累計でも上限が更新される', () => {
    const acc = cappedAccumulation(5000, [])
    const result = recalculateAccumulationForCapChange(acc, 10000 as Money, generateChildId)

    expect(result.kind).toBe('capped')
    if (result.kind !== 'capped') return
    expect(result.monthlyCap).toBe(10000)
    expect(result.currentTotal).toBe(0)
    expect(result.transactionRefs).toHaveLength(0)
  })

  it('既存の partial の childTransactionId が再利用される', () => {
    const acc = cappedAccumulation(3000, [
      { transactionId: TX1_ID, occurredAt: T1, amount: 3000, allocation: { kind: 'full' } },
      {
        transactionId: TX2_ID,
        occurredAt: T2,
        amount: 4000,
        allocation: {
          kind: 'partial',
          expenseAllocatedAmount: 0,
          personalAllocatedAmount: 4000,
          childTransactionId: CHILD1_ID,
        },
      },
    ])

    const result = recalculateAccumulationForCapChange(acc, 5000 as Money, generateChildId)

    expect(result.kind).toBe('capped')
    if (result.kind !== 'capped') return
    const tx2Alloc = result.transactionRefs[1]?.allocation
    expect(tx2Alloc?.kind).toBe('partial')
    if (tx2Alloc?.kind !== 'partial') return
    expect(tx2Alloc.childTransactionId).toBe(CHILD1_ID)
    expect(tx2Alloc.expenseAllocatedAmount).toBe(2000)
    expect(tx2Alloc.personalAllocatedAmount).toBe(2000)
  })

  it('capReached が正しく設定される', () => {
    const acc = cappedAccumulation(10000, [
      { transactionId: TX1_ID, occurredAt: T1, amount: 3000, allocation: { kind: 'full' } },
      { transactionId: TX2_ID, occurredAt: T2, amount: 4000, allocation: { kind: 'full' } },
    ])

    const result = recalculateAccumulationForCapChange(acc, 5000 as Money, generateChildId)

    expect(result.kind).toBe('capped')
    if (result.kind !== 'capped') return
    expect(result.capReached.kind).toBe('reached')
    if (result.capReached.kind !== 'reached') return
    expect(result.capReached.reachingTransactionId).toBe(TX2_ID)
  })

  it('同一上限で再計算しても結果が変わらない（冪等性）', () => {
    const acc = cappedAccumulation(5000, [
      { transactionId: TX1_ID, occurredAt: T1, amount: 3000, allocation: { kind: 'full' } },
      {
        transactionId: TX2_ID,
        occurredAt: T2,
        amount: 4000,
        allocation: {
          kind: 'partial',
          expenseAllocatedAmount: 2000,
          personalAllocatedAmount: 2000,
          childTransactionId: CHILD1_ID,
        },
      },
    ])

    const first = recalculateAccumulationForCapChange(acc, 5000 as Money, generateChildId)
    const second = recalculateAccumulationForCapChange(first, 5000 as Money, generateChildId)

    expect(second).toEqual(first)
  })

  it('FIFO 順: occurredAt の順で按分が決まる', () => {
    const acc = cappedAccumulation(100000, [
      { transactionId: TX2_ID, occurredAt: T2, amount: 4000, allocation: { kind: 'full' } },
      { transactionId: TX1_ID, occurredAt: T1, amount: 3000, allocation: { kind: 'full' } },
    ])

    const result = recalculateAccumulationForCapChange(acc, 5000 as Money, generateChildId)

    expect(result.kind).toBe('capped')
    if (result.kind !== 'capped') return
    // T1 (3000) が先に割り当てられ、T2 (4000) が partial になる
    const tx1 = result.transactionRefs.find(r => r.transactionId === TX1_ID)
    const tx2 = result.transactionRefs.find(r => r.transactionId === TX2_ID)
    expect(tx1).toBeDefined()
    expect(tx2).toBeDefined()
    if (!tx1 || !tx2) return
    expect(tx1.allocation.kind).toBe('full')
    expect(tx2.allocation.kind).toBe('partial')
    if (tx2.allocation.kind !== 'partial') return
    expect(tx2.allocation.expenseAllocatedAmount).toBe(2000)
  })
})
