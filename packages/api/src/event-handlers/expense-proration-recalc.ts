/**
 * 月次上限変更 → 当月按分再計算ハンドラー（#140）
 *
 * MonthlyLimitChanged / MonthlyLimitCreated を購読し、当月の集積中サイクルの
 * 経費種別累計を新しい上限に合わせて FIFO 再計算する（09 §2.3 結果整合）。
 *
 * 冪等性: 同一イベント再配信では同じ上限値で再計算するため、保存結果は同一。
 * サイクルが存在しない・集積中でない場合は no-op。
 */
import {
  MonthlyExpenseCycleSchema,
  recalculateAccumulationForCapChange,
  yearMonth,
} from '@warimaru/domain'
import type {
  ChildTransactionId,
  EventBus,
  MonthlyExpenseCycle,
  MonthlyExpenseCycleRepository,
  MonthlyLimitChanged,
  MonthlyLimitCreated,
  MonthlyLimitRepository,
  Money,
  UserId,
  ExpenseTypeId,
  YearMonth,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-neon'
import { safeSubscribe } from './safe-subscribe.js'

export interface ExpenseProrationRecalcHandlerDeps {
  monthlyLimitRepository: MonthlyLimitRepository
  monthlyExpenseCycleRepository: MonthlyExpenseCycleRepository
}

function toYearMonth(date: Date): YearMonth {
  return yearMonth(date.getUTCFullYear(), date.getUTCMonth() + 1)
}

function generateChildId(): ChildTransactionId {
  return newUlid() as unknown as ChildTransactionId
}

async function recalculateCycle(
  deps: ExpenseProrationRecalcHandlerDeps,
  userId: UserId,
  expenseTypeId: ExpenseTypeId,
  newCap: Money | null,
  occurredAt: Date,
): Promise<void> {
  const targetMonth = toYearMonth(occurredAt)
  const cycle = await deps.monthlyExpenseCycleRepository.findByUserAndMonth(userId, targetMonth)
  if (cycle === null || cycle.kind !== 'accumulating') return

  const accIndex = cycle.common.accumulations.findIndex(a => a.expenseTypeId === expenseTypeId)
  if (accIndex === -1) return

  const accumulation = cycle.common.accumulations[accIndex]
  if (accumulation === undefined) return
  const recalculated = recalculateAccumulationForCapChange(accumulation, newCap, generateChildId)

  const updatedAccumulations = [...cycle.common.accumulations]
  updatedAccumulations[accIndex] = recalculated

  const updatedCycle: MonthlyExpenseCycle = MonthlyExpenseCycleSchema.parse({
    ...cycle,
    common: {
      ...cycle.common,
      accumulations: updatedAccumulations,
    },
  })
  await deps.monthlyExpenseCycleRepository.save(updatedCycle)
}

export function registerExpenseProrationRecalcEventHandlers(
  eventBus: EventBus,
  deps: ExpenseProrationRecalcHandlerDeps,
): void {
  safeSubscribe<MonthlyLimitChanged>(eventBus, 'MonthlyLimitChanged', async event => {
    const limit = await deps.monthlyLimitRepository.findById(event.monthlyLimitId)
    if (limit === null) return

    const newCap = event.newLimit.kind === 'capped' ? event.newLimit.capAmount : null
    await recalculateCycle(deps, limit.userId, limit.expenseTypeId, newCap, event.occurredAt)
  })

  safeSubscribe<MonthlyLimitCreated>(eventBus, 'MonthlyLimitCreated', async event => {
    const newCap = event.seedLimit.kind === 'capped' ? event.seedLimit.capAmount : null
    await recalculateCycle(deps, event.userId, event.expenseTypeId, newCap, event.occurredAt)
  })
}
