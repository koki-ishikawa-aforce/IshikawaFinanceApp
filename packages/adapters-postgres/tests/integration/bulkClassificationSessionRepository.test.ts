import { describe, it, expect } from 'vitest'
import type {
  BulkClassificationSessionId,
  InProgressBulkClassificationSession,
} from '@warimaru/domain'
import {
  completeBulkClassificationSession,
  InvariantViolationError,
  advanceBulkClassificationSession,
} from '@warimaru/domain'
import { db } from './setup'
import { PostgresBulkClassificationSessionRepository } from '../../src/auto-classification/PostgresBulkClassificationSessionRepository'
import { bulkClassificationSessions } from '../../src/schema'
import { serializeForPayload } from '../../src/serialize'
import { DARLING_USER_ID, HONEY_USER_ID } from '../helpers/fixtures'
import { abortedSession, inProgressSession } from '../helpers/autoClassificationFixtures'

const repo = new PostgresBulkClassificationSessionRepository(db)

/** 進行中セッションの唯一の対象取引 ID */
function soleTargetId(session: InProgressBulkClassificationSession) {
  const target = session.common.targets[0]
  if (target === undefined) throw new Error('対象取引を 1 件持つセッションを期待')
  return target.transactionId
}

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

  it('進捗を記録した進行中セッションも往復同一（payload に分類済み取引が残る）', async () => {
    const inProgress = inProgressSession() as InProgressBulkClassificationSession
    await repo.save(inProgress)

    const advanced = advanceBulkClassificationSession(inProgress, [soleTargetId(inProgress)])
    await repo.save(advanced)

    const found = await repo.findById(inProgress.common.bulkClassificationSessionId)
    expect(found).toEqual(advanced)
    expect(found?.kind === 'in_progress' && found.remainingCount).toBe(0)
  })

  it('進捗を持たずに保存済みの行も読み戻せる（既存データの移行なしで読める）', async () => {
    const legacy = inProgressSession() as InProgressBulkClassificationSession
    const { classifiedTransactionIds: _omitted, ...withoutProgress } = legacy
    await db.insert(bulkClassificationSessions).values({
      bulkClassificationSessionId: legacy.common.bulkClassificationSessionId,
      userId: legacy.common.userId,
      kind: legacy.kind,
      payload: serializeForPayload(withoutProgress),
    })

    const found = await repo.findById(legacy.common.bulkClassificationSessionId)
    expect(found?.kind === 'in_progress' && found.classifiedTransactionIds).toEqual([])
    expect(found?.kind === 'in_progress' && found.remainingCount).toBe(1)
  })

  it('残件数が対象取引数と食い違う既存行は読み出しで弾かれる（黙って直さない）', async () => {
    // この形の行は本番には存在しない: 進行中を作るのは開始処理の 1 箇所だけで、
    // そこは必ず 残件数 = 対象取引数 で書く。将来ここが崩れたときに
    // 「静かに読めてしまう」のではなく落ちることを固定しておく
    const legacy = inProgressSession() as InProgressBulkClassificationSession
    const { classifiedTransactionIds: _omitted, ...withoutProgress } = legacy
    await db.insert(bulkClassificationSessions).values({
      bulkClassificationSessionId: legacy.common.bulkClassificationSessionId,
      userId: legacy.common.userId,
      kind: legacy.kind,
      payload: serializeForPayload({ ...withoutProgress, remainingCount: 99 }),
    })

    await expect(repo.findById(legacy.common.bulkClassificationSessionId)).rejects.toThrow()
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
