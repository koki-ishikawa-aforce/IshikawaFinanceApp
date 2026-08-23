import { describe, it, expect } from 'vitest'
import type {
  BulkClassificationSessionId,
  InProgressBulkClassificationSession,
} from '@warimaru/domain'
import { completeBulkClassificationSession, InvariantViolationError } from '@warimaru/domain'
import { db } from './setup'
import { PostgresBulkClassificationSessionRepository } from '../../src/auto-classification/PostgresBulkClassificationSessionRepository'
import { DARLING_USER_ID, HONEY_USER_ID } from '../helpers/fixtures'
import { abortedSession, inProgressSession } from '../helpers/autoClassificationFixtures'

const repo = new PostgresBulkClassificationSessionRepository(db)

describe('PostgresBulkClassificationSessionRepository', () => {
  it('save → findById の往復同一性（in_progress / completed / aborted 全変種）', async () => {
    const inProgress = inProgressSession() as InProgressBulkClassificationSession
    await repo.save(inProgress)
    expect(await repo.findById(inProgress.common.bulkClassificationSessionId)).toEqual(inProgress)

    const completed = completeBulkClassificationSession(
      inProgress,
      1,
      new Date('2026-07-01T02:00:00.000Z'),
    )
    await repo.save(completed)
    expect(await repo.findById(inProgress.common.bulkClassificationSessionId)).toEqual(completed)

    const aborted = abortedSession({ userId: DARLING_USER_ID })
    await repo.save(aborted)
    expect(await repo.findById(aborted.common.bulkClassificationSessionId)).toEqual(aborted)
  })

  it('未知の ID は null', async () => {
    expect(
      await repo.findById('01HZZZZZZZZZZZZZZZZZZZZZZZ' as BulkClassificationSessionId),
    ).toBeNull()
  })

  it('findInProgressByUser は進行中のみ返す（終端状態や配偶者のセッションは対象外）', async () => {
    const mine = inProgressSession({ userId: HONEY_USER_ID })
    await repo.save(mine)
    await repo.save(abortedSession({ userId: HONEY_USER_ID }))
    await repo.save(inProgressSession({ userId: DARLING_USER_ID }))
    expect(await repo.findInProgressByUser(HONEY_USER_ID)).toEqual(mine)
  })

  it('進行中がなければ findInProgressByUser は null', async () => {
    await repo.save(abortedSession({ userId: HONEY_USER_ID }))
    expect(await repo.findInProgressByUser(HONEY_USER_ID)).toBeNull()
  })

  it('同一ユーザーの進行中セッション二重起動は InvariantViolationError（partial unique）', async () => {
    await repo.save(inProgressSession({ userId: HONEY_USER_ID }))
    await expect(repo.save(inProgressSession({ userId: HONEY_USER_ID }))).rejects.toThrow(
      InvariantViolationError,
    )
  })

  it('進行中 → 完了の遷移後は新しい進行中セッションを起動できる', async () => {
    const first = inProgressSession({
      userId: HONEY_USER_ID,
    }) as InProgressBulkClassificationSession
    await repo.save(first)
    await repo.save(
      completeBulkClassificationSession(first, 1, new Date('2026-07-01T02:00:00.000Z')),
    )
    await expect(repo.save(inProgressSession({ userId: HONEY_USER_ID }))).resolves.toBeUndefined()
  })
})
