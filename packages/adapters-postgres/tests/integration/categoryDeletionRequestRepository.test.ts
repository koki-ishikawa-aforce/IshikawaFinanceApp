import { describe, it, expect } from 'vitest'
import type { CategoryDeletionRequestId } from '@warimaru/domain'
import type { PendingRemapCategoryDeletionRequest } from '@warimaru/domain'
import {
  completeCategoryRemap,
  recordCategoryRemapContextCompletion,
  requestCategoryRemap,
} from '@warimaru/domain'
import { eq, sql } from 'drizzle-orm'
import { ZodError } from 'zod'
import { db } from './setup'
import { categoryDeletionRequests } from '../../src/schema'
import { PostgresCategoryDeletionRequestRepository } from '../../src/master-data/PostgresCategoryDeletionRequestRepository'
import { categoryDeletionRequest } from '../helpers/masterDataFixtures'

const repo = new PostgresCategoryDeletionRequestRepository(db)

/** 昇格列 state_kind は findById の select に含まれないため、テーブルから直接読む */
async function selectStateKind(id: CategoryDeletionRequestId): Promise<string | undefined> {
  const rows = await db
    .select({ stateKind: categoryDeletionRequests.stateKind })
    .from(categoryDeletionRequests)
    .where(eq(categoryDeletionRequests.categoryDeletionRequestId, id))
  return rows[0]?.stateKind
}

describe('PostgresCategoryDeletionRequestRepository', () => {
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
    // 完了記録が2件並んだ状態の往復（jsonb 配列の永続化）
    await repo.save(afterAuto)
    expect(await repo.findById(pending.categoryDeletionRequestId)).toEqual(afterAuto)
    // findById は payload しか読まないため、昇格列 state_kind の追随は直接確認する
    expect(await selectStateKind(pending.categoryDeletionRequestId)).toBe('remap_requested')

    const completed = completeCategoryRemap(afterAuto, at)
    await repo.save(completed)
    expect(await repo.findById(pending.categoryDeletionRequestId)).toEqual(completed)
    expect(await selectStateKind(pending.categoryDeletionRequestId)).toBe('remap_completed')
  })

  it('payload 破損（同じコンテキストの完了通知が2件並ぶ）は findById 時に ZodError（superRefine 再適用）', async () => {
    const pending = categoryDeletionRequest() as PendingRemapCategoryDeletionRequest
    await repo.save(pending)
    const at = new Date('2026-07-02T00:00:00.000Z')
    const requested = requestCategoryRemap(pending, ['household_analysis'], at)
    await repo.save(requested)

    const duplicatedCompletedContexts = JSON.stringify([
      {
        context: 'household_analysis',
        affectedTransactionCount: 3,
        affectedLearningRuleCount: 0,
        completedAt: at.toISOString(),
      },
      {
        context: 'household_analysis',
        affectedTransactionCount: 5,
        affectedLearningRuleCount: 0,
        completedAt: at.toISOString(),
      },
    ])
    await db.execute(
      sql`UPDATE category_deletion_requests
          SET payload = jsonb_set(payload, '{state,completedContexts}', ${duplicatedCompletedContexts}::jsonb)
          WHERE category_deletion_request_id = ${pending.categoryDeletionRequestId}`,
    )
    await expect(repo.findById(pending.categoryDeletionRequestId)).rejects.toThrow(ZodError)
  })
})
