import { describe, it, expect } from 'vitest'
import type {
  BulkClassificationSession,
  BulkClassificationSessionId,
  InProgressBulkClassificationSession,
} from '@warimaru/domain'
import {
  completeBulkClassificationSession,
  ConcurrentUpdateError,
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

/** 版数だけを差し替えたセッションを返す（upsert 後の期待値を組み立てるヘルパー） */
function withVersion(
  session: BulkClassificationSession,
  version: number,
): BulkClassificationSession {
  return { ...session, common: { ...session.common, version } }
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
    // 同一行への 2 回目の保存で版数が 1 進む（completed 自体は common をそのまま引き継ぐため版数 0 のまま）
    expect(await repo.findById(inProgress.common.bulkClassificationSessionId)).toEqual(
      withVersion(completed, 1),
    )

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
    expect(found).toEqual(withVersion(advanced, 1))
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

  // --- #609: 進捗記録の並行更新競合（楽観ロック） ---

  it('版数は保存のたびに 1 進む（既存行への上書き）', async () => {
    const inProgress = inProgressSession() as InProgressBulkClassificationSession
    await repo.save(inProgress)
    // 新規 insert 後は版数 0
    const v0 = await repo.findById(inProgress.common.bulkClassificationSessionId)
    expect(v0?.common.version).toBe(0)
    // 1 回進めると版数 1
    const advanced = advanceBulkClassificationSession(v0 as InProgressBulkClassificationSession, [
      soleTargetId(inProgress),
    ])
    await repo.save(advanced)
    const v1 = await repo.findById(inProgress.common.bulkClassificationSessionId)
    expect(v1?.common.version).toBe(1)
  })

  it('古い版で保存し直すと ConcurrentUpdateError（同時更新の後勝ちを防ぐ）', async () => {
    const session = inProgressSession({
      userId: HONEY_USER_ID,
    }) as InProgressBulkClassificationSession
    await repo.save(session)

    // 2 台の端末が同じ版（0）を読み出す
    const readA = (await repo.findById(
      session.common.bulkClassificationSessionId,
    )) as InProgressBulkClassificationSession
    const readB = (await repo.findById(
      session.common.bulkClassificationSessionId,
    )) as InProgressBulkClassificationSession
    expect(readA.common.version).toBe(0)
    expect(readB.common.version).toBe(0)

    // A が先に進捗を保存 → 版数 1 へ
    const a = advanceBulkClassificationSession(readA, [soleTargetId(session)])
    await repo.save(a)

    // B は読んだときの版（0）のまま保存しようとする → 拒否（A の更新を消さない）
    const b = advanceBulkClassificationSession(readB, [soleTargetId(session)])
    await expect(repo.save(b)).rejects.toThrow(ConcurrentUpdateError)

    // A の更新だけが残る（B は上書きしていない）
    const reloaded = (await repo.findById(
      session.common.bulkClassificationSessionId,
    )) as InProgressBulkClassificationSession
    expect(reloaded.remainingCount).toBe(0)
    expect(reloaded.common.version).toBe(1)

    // B は最新版を読み直せばやり直せる（一時的な競合であることの確認）
    await expect(repo.save(advanceBulkClassificationSession(reloaded, []))).resolves.toBeUndefined()
    const final = (await repo.findById(
      session.common.bulkClassificationSessionId,
    )) as InProgressBulkClassificationSession
    expect(final.common.version).toBe(2)
  })

  it('版数列を持たない既存行は版数 0 として読み出せる（後方互換）', async () => {
    const legacy = inProgressSession({
      userId: HONEY_USER_ID,
    }) as InProgressBulkClassificationSession
    // payload に version キー自体を含めない（この項目を持たない本物の既存行の形）。
    // common.version は既定値 0 を持つため、payload に残したまま INSERT すると
    // 「版数列ではなく payload 側を読んでいる」実装のリグレッションを検出できない。
    const payload = serializeForPayload(legacy) as { common: Record<string, unknown> }
    delete payload.common.version
    // version 列を明示せずに INSERT する（DEFAULT 0 で埋まることを確認する）
    await db.insert(bulkClassificationSessions).values({
      bulkClassificationSessionId: legacy.common.bulkClassificationSessionId,
      userId: legacy.common.userId,
      kind: legacy.kind,
      payload,
    })

    const found = await repo.findById(legacy.common.bulkClassificationSessionId)
    expect(found?.common.version).toBe(0)

    // 版数 0 のまま保存し直せる（読み書きの両方が成立する）
    await expect(repo.save(legacy)).resolves.toBeUndefined()
    const reloaded = await repo.findById(legacy.common.bulkClassificationSessionId)
    expect(reloaded?.common.version).toBe(1)
  })
})
