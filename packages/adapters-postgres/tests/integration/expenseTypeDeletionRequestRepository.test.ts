import { describe, it, expect } from 'vitest'
import type { ExpenseTypeDeletionRequestId } from '@warimaru/domain'
import type { PendingRemapExpenseTypeDeletionRequest } from '@warimaru/domain'
import { failExpenseTypeRemap, requestExpenseTypeRemap } from '@warimaru/domain'
import { db } from './setup'
import { NeonExpenseTypeDeletionRequestRepository } from '../../src/master-data/NeonExpenseTypeDeletionRequestRepository'
import { expenseTypeDeletionRequest } from '../helpers/masterDataFixtures'

const repo = new NeonExpenseTypeDeletionRequestRepository(db)

describe('NeonExpenseTypeDeletionRequestRepository', () => {
  it('save → findById の往復同一性（pending_remap）', async () => {
    const request = expenseTypeDeletionRequest()
    await repo.save(request)
    expect(await repo.findById(request.expenseTypeDeletionRequestId)).toEqual(request)
  })

  it('未知の ID は null', async () => {
    expect(
      await repo.findById('01HZZZZZZZZZZZZZZZZZZZZZZZ' as ExpenseTypeDeletionRequestId),
    ).toBeNull()
  })

  it('状態遷移の再 save で上書きされる（remap_failed も保存できる）', async () => {
    const pending = expenseTypeDeletionRequest() as PendingRemapExpenseTypeDeletionRequest
    await repo.save(pending)
    const at = new Date('2026-07-02T00:00:00.000Z')
    const requested = requestExpenseTypeRemap(pending, ['expense_settlement'], at)
    await repo.save(requested)
    const failed = failExpenseTypeRemap(requested, '保存に失敗', at)
    await repo.save(failed)
    expect(await repo.findById(pending.expenseTypeDeletionRequestId)).toEqual(failed)
  })
})
