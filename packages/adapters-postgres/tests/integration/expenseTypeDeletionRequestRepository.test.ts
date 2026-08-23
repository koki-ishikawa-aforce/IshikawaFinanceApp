import { describe, it, expect } from 'vitest'
import type { ExpenseTypeDeletionRequestId } from '@warimaru/domain'
import type { PendingRemapExpenseTypeDeletionRequest } from '@warimaru/domain'
import {
  completeExpenseTypeRemap,
  failExpenseTypeRemap,
  recordExpenseTypeRemapContextCompletion,
  requestExpenseTypeRemap,
} from '@warimaru/domain'
import { eq } from 'drizzle-orm'
import { db } from './setup'
import { expenseTypeDeletionRequests } from '../../src/schema'
import { PostgresExpenseTypeDeletionRequestRepository } from '../../src/master-data/PostgresExpenseTypeDeletionRequestRepository'
import { expenseTypeDeletionRequest } from '../helpers/masterDataFixtures'

const repo = new PostgresExpenseTypeDeletionRequestRepository(db)

/** 昇格列 state_kind は findById の select に含まれないため、テーブルから直接読む */
async function selectStateKind(id: ExpenseTypeDeletionRequestId): Promise<string | undefined> {
  const rows = await db
    .select({ stateKind: expenseTypeDeletionRequests.stateKind })
    .from(expenseTypeDeletionRequests)
    .where(eq(expenseTypeDeletionRequests.expenseTypeDeletionRequestId, id))
  return rows[0]?.stateKind
}

describe('PostgresExpenseTypeDeletionRequestRepository', () => {
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

  it('複数コンテキストの完了記録と remap_completed が往復して同一（pending_remap → remap_requested → remap_completed）', async () => {
    const pending = expenseTypeDeletionRequest() as PendingRemapExpenseTypeDeletionRequest
    await repo.save(pending)
    const at = new Date('2026-07-02T00:00:00.000Z')
    const requested = requestExpenseTypeRemap(
      pending,
      ['expense_settlement', 'auto_classification'],
      at,
    )
    await repo.save(requested)
    expect(await repo.findById(pending.expenseTypeDeletionRequestId)).toEqual(requested)

    // 各コンテキストの完了通知を記録（completedContexts の永続化往復も検証）
    const afterSettlement = recordExpenseTypeRemapContextCompletion(
      requested,
      { context: 'expense_settlement', affectedTransactionCount: 2, affectedLearningRuleCount: 0 },
      at,
    )
    await repo.save(afterSettlement)
    expect(await repo.findById(pending.expenseTypeDeletionRequestId)).toEqual(afterSettlement)

    const afterAuto = recordExpenseTypeRemapContextCompletion(
      afterSettlement,
      { context: 'auto_classification', affectedTransactionCount: 0, affectedLearningRuleCount: 1 },
      at,
    )
    await repo.save(afterAuto)
    expect(await repo.findById(pending.expenseTypeDeletionRequestId)).toEqual(afterAuto)

    // findById は payload しか読まないため、昇格列 state_kind の追随は直接確認する
    expect(await selectStateKind(pending.expenseTypeDeletionRequestId)).toBe('remap_requested')

    const completed = completeExpenseTypeRemap(afterAuto, at)
    await repo.save(completed)
    expect(await repo.findById(pending.expenseTypeDeletionRequestId)).toEqual(completed)
    expect(await selectStateKind(pending.expenseTypeDeletionRequestId)).toBe('remap_completed')
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
