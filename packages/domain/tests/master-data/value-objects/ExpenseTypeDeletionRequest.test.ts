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

  it('pending_remap → remap_requested → remap_failed', () => {
    const requested = requestExpenseTypeRemap(pendingRequest(), ['expense_settlement'], at)
    const failed = failExpenseTypeRemap(requested, '保存に失敗', at)
    expect(failed.state.kind).toBe('remap_failed')
  })

  it('remap_failed 状態は失敗詳細が必須', () => {
    const requested = requestExpenseTypeRemap(pendingRequest(), ['expense_settlement'], at)
    expect(() => failExpenseTypeRemap(requested, '', at)).toThrow()
  })
})
