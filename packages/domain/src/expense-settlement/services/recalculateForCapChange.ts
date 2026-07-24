/**
 * 月次上限変更に伴う経費種別累計の按分再計算（08h §2 事後条件、09 §2.3 結果整合）
 *
 * 純粋関数。MonthlyLimitChanged / MonthlyLimitCreated イベントの購読ハンドラーから呼ばれ、
 * 対象の経費種別累計を新しい上限に合わせて FIFO 順で再計算する。
 */
import {
  ExpenseTypeAccumulationSchema,
  type ExpenseTypeAccumulation,
  type ExpenseTransactionRef,
  type CapReachedState,
} from '../value-objects/ExpenseTypeAccumulation'
import type { Money } from '../../shared/value-objects/Money'
import type { ChildTransactionId } from '../../shared/ids'

export function recalculateAccumulationForCapChange(
  accumulation: ExpenseTypeAccumulation,
  newCap: Money | null,
  generateChildId: () => ChildTransactionId,
): ExpenseTypeAccumulation {
  const sortedRefs = [...accumulation.transactionRefs].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  )

  if (newCap === null) {
    return toUnlimited(accumulation, sortedRefs)
  }
  return toCapped(accumulation, sortedRefs, newCap, generateChildId)
}

function toUnlimited(
  accumulation: ExpenseTypeAccumulation,
  sortedRefs: ExpenseTransactionRef[],
): ExpenseTypeAccumulation {
  const fullRefs = sortedRefs.map(ref => ({
    transactionId: ref.transactionId,
    occurredAt: ref.occurredAt,
    amount: ref.amount,
    allocation: { kind: 'full' as const },
  }))
  const currentTotal = fullRefs.reduce((sum, ref) => sum + ref.amount, 0)
  return ExpenseTypeAccumulationSchema.parse({
    kind: 'unlimited',
    accumulationId: accumulation.accumulationId,
    expenseTypeId: accumulation.expenseTypeId,
    userId: accumulation.userId,
    currentTotal,
    transactionRefs: fullRefs,
  })
}

function toCapped(
  accumulation: ExpenseTypeAccumulation,
  sortedRefs: ExpenseTransactionRef[],
  newCap: Money,
  generateChildId: () => ChildTransactionId,
): ExpenseTypeAccumulation {
  let runningTotal = 0
  let capReached: CapReachedState = { kind: 'not_reached' }

  const recalculatedRefs: ExpenseTransactionRef[] = sortedRefs.map(ref => {
    if (runningTotal >= newCap) {
      const childId =
        ref.allocation.kind === 'partial' ? ref.allocation.childTransactionId : generateChildId()
      return {
        transactionId: ref.transactionId,
        occurredAt: ref.occurredAt,
        amount: ref.amount,
        allocation: {
          kind: 'partial' as const,
          expenseAllocatedAmount: 0 as Money,
          personalAllocatedAmount: ref.amount,
          childTransactionId: childId,
        },
      }
    }

    if (runningTotal + ref.amount <= newCap) {
      runningTotal += ref.amount
      return {
        transactionId: ref.transactionId,
        occurredAt: ref.occurredAt,
        amount: ref.amount,
        allocation: { kind: 'full' as const },
      }
    }

    const expenseAmount = (newCap - runningTotal) as Money
    const personalAmount = (ref.amount - expenseAmount) as Money
    capReached = {
      kind: 'reached',
      reachedAt: ref.occurredAt,
      reachingTransactionId: ref.transactionId,
    }
    runningTotal = newCap
    const childId =
      ref.allocation.kind === 'partial' ? ref.allocation.childTransactionId : generateChildId()
    return {
      transactionId: ref.transactionId,
      occurredAt: ref.occurredAt,
      amount: ref.amount,
      allocation: {
        kind: 'partial' as const,
        expenseAllocatedAmount: expenseAmount,
        personalAllocatedAmount: personalAmount,
        childTransactionId: childId,
      },
    }
  })

  const currentTotal = recalculatedRefs.reduce((sum, ref) => {
    if (ref.allocation.kind === 'full') return sum + ref.amount
    return sum + ref.allocation.expenseAllocatedAmount
  }, 0)

  return ExpenseTypeAccumulationSchema.parse({
    kind: 'capped',
    accumulationId: accumulation.accumulationId,
    expenseTypeId: accumulation.expenseTypeId,
    userId: accumulation.userId,
    monthlyCap: newCap,
    currentTotal,
    capReached,
    transactionRefs: recalculatedRefs,
  })
}
