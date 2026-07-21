import { describe, it, expect } from 'vitest'
import {
  CategoryDeletionRequestSchema,
  completeCategoryRemap,
  failCategoryRemap,
  requestCategoryRemap,
} from '../../../src/master-data/value-objects/CategoryDeletionRequest'
import type { PendingRemapCategoryDeletionRequest } from '../../../src/master-data/value-objects/CategoryDeletionRequest'
import { testUlid } from '../../helpers/ids'

function pendingRequest(overrides: Record<string, unknown> = {}) {
  return CategoryDeletionRequestSchema.parse({
    categoryDeletionRequestId: testUlid('01CDR'),
    targetCategoryId: testUlid('01CAT', 1),
    requestedByUserId: 'user_honey',
    destinationCategoryId: testUlid('01CAT', 2),
    destinationExpenseClass: 'household',
    requestedAt: new Date('2026-07-01T00:00:00Z'),
    state: { kind: 'pending_remap' },
    ...overrides,
  }) as PendingRemapCategoryDeletionRequest
}

describe('CategoryDeletionRequest', () => {
  it('リマップ依頼前の削除リクエストは parse 成功', () => {
    expect(() => pendingRequest()).not.toThrow()
  })

  it('移動先費用区分が経費(会社)なら移動先経費種別ID 必須', () => {
    expect(() => pendingRequest({ destinationExpenseClass: 'business_expense' })).toThrow()
    expect(() =>
      pendingRequest({
        destinationExpenseClass: 'business_expense',
        destinationExpenseTypeId: testUlid('01ET'),
      }),
    ).not.toThrow()
  })

  it('移動先費用区分が経費(会社)以外なら移動先経費種別ID は指定不可', () => {
    expect(() =>
      pendingRequest({
        destinationExpenseClass: 'household',
        destinationExpenseTypeId: testUlid('01ET'),
      }),
    ).toThrow()
  })

  it('リマップ依頼済み状態は依頼先コンテキスト 1 件以上が必須', () => {
    expect(() =>
      pendingRequest({
        state: { kind: 'remap_requested', requestedAt: new Date(), requestedContexts: [] },
      }),
    ).toThrow()
  })
})

describe('CategoryDeletionRequest 状態遷移', () => {
  const at = new Date('2026-07-02T00:00:00Z')

  it('pending_remap → remap_requested → remap_completed', () => {
    const requested = requestCategoryRemap(
      pendingRequest(),
      ['household_analysis', 'auto_classification'],
      at,
    )
    expect(requested.state.kind).toBe('remap_requested')
    expect(requested.state.requestedContexts).toEqual(['household_analysis', 'auto_classification'])

    const completed = completeCategoryRemap(
      requested,
      { affectedTransactionCount: 3, affectedLearningRuleCount: 2 },
      at,
    )
    expect(completed.state.kind).toBe('remap_completed')
    expect(completed.state.affectedTransactionCount).toBe(3)
    expect(completed.state.affectedLearningRuleCount).toBe(2)
  })

  it('pending_remap → remap_requested → remap_failed', () => {
    const requested = requestCategoryRemap(pendingRequest(), ['household_analysis'], at)
    const failed = failCategoryRemap(requested, 'DB接続断', at)
    expect(failed.state.kind).toBe('remap_failed')
    expect(failed.state.failureDetail).toBe('DB接続断')
  })
})
