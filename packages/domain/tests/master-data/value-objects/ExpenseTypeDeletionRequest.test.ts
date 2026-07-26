import { describe, it, expect } from 'vitest'
import {
  ExpenseTypeDeletionRequestSchema,
  completeExpenseTypeRemap,
  failExpenseTypeRemap,
  isExpenseTypeRemapFullyCompleted,
  recordExpenseTypeRemapContextCompletion,
  requestExpenseTypeRemap,
} from '../../../src/master-data/value-objects/ExpenseTypeDeletionRequest'
import type { PendingRemapExpenseTypeDeletionRequest } from '../../../src/master-data/value-objects/ExpenseTypeDeletionRequest'
import { testUlid } from '../../helpers/ids'

function pendingRequest() {
  return ExpenseTypeDeletionRequestSchema.parse({
    expenseTypeDeletionRequestId: testUlid('01EDR'),
    targetExpenseTypeId: testUlid('01ET', 1),
    requestedByUserId: 'user_darling',
    destinationExpenseTypeId: testUlid('01ET', 2),
    requestedAt: new Date('2026-07-01T00:00:00Z'),
    state: { kind: 'pending_remap' },
  }) as PendingRemapExpenseTypeDeletionRequest
}

describe('ExpenseTypeDeletionRequest 状態遷移', () => {
  const at = new Date('2026-07-02T00:00:00Z')

  it('pending_remap → remap_requested → 各コンテキスト完了記録 → remap_completed', () => {
    const requested = requestExpenseTypeRemap(
      pendingRequest(),
      ['expense_settlement', 'auto_classification'],
      at,
    )
    expect(requested.state.kind).toBe('remap_requested')
    expect(requested.state.completedContexts).toEqual([])
    expect(isExpenseTypeRemapFullyCompleted(requested)).toBe(false)

    const afterSettlement = recordExpenseTypeRemapContextCompletion(
      requested,
      { context: 'expense_settlement', affectedTransactionCount: 1, affectedLearningRuleCount: 0 },
      at,
    )
    expect(isExpenseTypeRemapFullyCompleted(afterSettlement)).toBe(false)

    const afterAuto = recordExpenseTypeRemapContextCompletion(
      afterSettlement,
      { context: 'auto_classification', affectedTransactionCount: 0, affectedLearningRuleCount: 4 },
      at,
    )
    expect(isExpenseTypeRemapFullyCompleted(afterAuto)).toBe(true)

    const completed = completeExpenseTypeRemap(afterAuto, at)
    expect(completed.state.kind).toBe('remap_completed')
    expect(completed.state.affectedTransactionCount).toBe(1)
    expect(completed.state.affectedLearningRuleCount).toBe(4)
  })

  it('同一コンテキストの完了通知は冪等（再記録しても件数を二重加算しない）', () => {
    const requested = requestExpenseTypeRemap(
      pendingRequest(),
      ['expense_settlement', 'auto_classification'],
      at,
    )
    const once = recordExpenseTypeRemapContextCompletion(
      requested,
      { context: 'expense_settlement', affectedTransactionCount: 3, affectedLearningRuleCount: 0 },
      at,
    )
    // 再配信時は対象 ID の取引が既に存在せず 0 件で通知される（master-data-remap の再配信規則）。
    // 上書きではなく無視であることを、件数の異なる再通知で区別する。
    const twice = recordExpenseTypeRemapContextCompletion(
      once,
      { context: 'expense_settlement', affectedTransactionCount: 0, affectedLearningRuleCount: 0 },
      at,
    )
    expect(twice.state.completedContexts).toHaveLength(1)
    expect(twice.state.completedContexts[0]?.affectedTransactionCount).toBe(3)
    // 再通知だけでは残りのコンテキストが埋まらない（物理削除の前提条件を満たさない）
    expect(isExpenseTypeRemapFullyCompleted(twice)).toBe(false)

    const afterAuto = recordExpenseTypeRemapContextCompletion(
      twice,
      { context: 'auto_classification', affectedTransactionCount: 0, affectedLearningRuleCount: 2 },
      at,
    )
    const completed = completeExpenseTypeRemap(afterAuto, at)
    // 初回の通知が再通知に上書きされていない（3 / 2 のまま）
    expect(completed.state.affectedTransactionCount).toBe(3)
    expect(completed.state.affectedLearningRuleCount).toBe(2)
  })

  it('pending_remap → remap_requested → remap_failed', () => {
    const requested = requestExpenseTypeRemap(pendingRequest(), ['expense_settlement'], at)
    const failed = failExpenseTypeRemap(requested, '保存に失敗', at)
    expect(failed.state.kind).toBe('remap_failed')
    expect(failed.state.failureDetail).toBe('保存に失敗')
  })

  it('remap_failed 状態は失敗詳細が必須', () => {
    const requested = requestExpenseTypeRemap(pendingRequest(), ['expense_settlement'], at)
    expect(() => failExpenseTypeRemap(requested, '', at)).toThrow()
  })
})
