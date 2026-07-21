import { describe, it, expect } from 'vitest'
import type { CategoryDeletionRequestId } from '@warimaru/domain'
import type { PendingRemapCategoryDeletionRequest } from '@warimaru/domain'
import { completeCategoryRemap, requestCategoryRemap } from '@warimaru/domain'
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

    const completed = completeCategoryRemap(
      requested,
      { affectedTransactionCount: 2, affectedLearningRuleCount: 1 },
      at,
    )
    await repo.save(completed)
    expect(await repo.findById(pending.categoryDeletionRequestId)).toEqual(completed)
  })
})
