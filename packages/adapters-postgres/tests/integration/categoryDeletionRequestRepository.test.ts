import { describe, it, expect } from 'vitest'
import type { CategoryDeletionRequestId } from '@warimaru/domain'
import type { PendingRemapCategoryDeletionRequest } from '@warimaru/domain'
import {
  completeCategoryRemap,
  recordCategoryRemapContextCompletion,
  requestCategoryRemap,
} from '@warimaru/domain'
import { db } from './setup'
import { NeonCategoryDeletionRequestRepository } from '../../src/master-data/NeonCategoryDeletionRequestRepository'
import { categoryDeletionRequest } from '../helpers/masterDataFixtures'

const repo = new NeonCategoryDeletionRequestRepository(db)

describe('NeonCategoryDeletionRequestRepository', () => {
  it('save → findById の往復同一性（pending_remap）', async () => {
    const request = categoryDeletionRequest()
    await repo.save(request)
    expect(await repo.findById(request.categoryDeletionRequestId)).toEqual(request)
  })

  it('未知の ID は null', async () => {
    expect(
      await repo.findById('01HZZZZZZZZZZZZZZZZZZZZZZZ' as CategoryDeletionRequestId),
    ).toBeNull()
  })

  it('状態遷移の再 save で上書きされる（pending_remap → remap_requested → remap_completed）', async () => {
    const pending = categoryDeletionRequest() as PendingRemapCategoryDeletionRequest
    await repo.save(pending)
    const at = new Date('2026-07-02T00:00:00.000Z')
    const requested = requestCategoryRemap(
      pending,
      ['household_analysis', 'auto_classification'],
      at,
    )
    await repo.save(requested)
    expect(await repo.findById(pending.categoryDeletionRequestId)).toEqual(requested)

    // 各コンテキストの完了通知を記録（completedContexts の永続化往復も検証）
    const afterHousehold = recordCategoryRemapContextCompletion(
      requested,
      { context: 'household_analysis', affectedTransactionCount: 2, affectedLearningRuleCount: 0 },
      at,
    )
    await repo.save(afterHousehold)
    expect(await repo.findById(pending.categoryDeletionRequestId)).toEqual(afterHousehold)

    const afterAuto = recordCategoryRemapContextCompletion(
      afterHousehold,
      { context: 'auto_classification', affectedTransactionCount: 0, affectedLearningRuleCount: 1 },
      at,
    )

    const completed = completeCategoryRemap(afterAuto, at)
    await repo.save(completed)
    expect(await repo.findById(pending.categoryDeletionRequestId)).toEqual(completed)
  })
})
