import { describe, it, expect } from 'vitest'
import type { ImportBatchId, StartedImportBatch } from '@warimaru/domain'
import { completeBatch, InvariantViolationError, startBatchImporting } from '@warimaru/domain'
import { db } from './setup'
import { PostgresDailyMailImportBatchRepository } from '../../src/transaction-import/PostgresDailyMailImportBatchRepository'
import { DARLING_USER_ID, HONEY_USER_ID } from '../helpers/fixtures'
import { completedBatch, startedBatch } from '../helpers/transactionImportFixtures'

const repo = new PostgresDailyMailImportBatchRepository(db)

describe('PostgresDailyMailImportBatchRepository', () => {
  it('save → findById の往復同一性（started → importing → completed の遷移上書き）', async () => {
    const started = startedBatch() as StartedImportBatch
    await repo.save(started)
    expect(await repo.findById(started.common.importBatchId)).toEqual(started)

    const importing = startBatchImporting(started, new Date('2026-07-07T00:01:00.000Z'))
    await repo.save(importing)
    expect(await repo.findById(started.common.importBatchId)).toEqual(importing)

    const completed = completeBatch(
      importing,
      { importedCount: 5, duplicateExcludedCount: 2, failedCount: 0 },
      new Date('2026-07-07T00:10:00.000Z'),
    )
    await repo.save(completed)
    expect(await repo.findById(started.common.importBatchId)).toEqual(completed)
  })

  it('未知の ID は null', async () => {
    expect(await repo.findById('01HZZZZZZZZZZZZZZZZZZZZZZZ' as ImportBatchId)).toBeNull()
  })

  it('findInProgressByUser は started / importing を進行中として返す', async () => {
    const started = startedBatch({ userId: HONEY_USER_ID }) as StartedImportBatch
    await repo.save(started)
    expect(await repo.findInProgressByUser(HONEY_USER_ID)).toEqual(started)

    const importing = startBatchImporting(started, new Date('2026-07-07T00:01:00.000Z'))
    await repo.save(importing)
    expect(await repo.findInProgressByUser(HONEY_USER_ID)).toEqual(importing)
  })

  it('終端状態（completed）のみなら findInProgressByUser は null', async () => {
    await repo.save(completedBatch({ userId: HONEY_USER_ID }))
    expect(await repo.findInProgressByUser(HONEY_USER_ID)).toBeNull()
  })

  it('同一ユーザーの進行中バッチ二重起動は InvariantViolationError（配偶者は起動できる）', async () => {
    await repo.save(startedBatch({ userId: HONEY_USER_ID }))
    await expect(repo.save(startedBatch({ userId: HONEY_USER_ID }))).rejects.toThrow(
      InvariantViolationError,
    )
    await expect(repo.save(startedBatch({ userId: DARLING_USER_ID }))).resolves.toBeUndefined()
  })

  it('findLatestByUser は状態を問わず直近に起動したバッチを返す', async () => {
    // 手動実行のクールダウン判定は「直近の実行」を状態に関わらず見る（#489）。終端で
    // 終わったバッチしか無いときに null が返ると、完了直後の連打を止められない
    const older = completedBatch({ userId: HONEY_USER_ID })
    await repo.save(older)
    expect(await repo.findLatestByUser(HONEY_USER_ID)).toEqual(older)

    const newer = startedBatch({ userId: HONEY_USER_ID })
    await repo.save(newer)
    expect(await repo.findLatestByUser(HONEY_USER_ID)).toEqual(newer)
  })

  it('findLatestByUser は配偶者のバッチを返さない（実行が無ければ null）', async () => {
    await repo.save(completedBatch({ userId: HONEY_USER_ID }))
    expect(await repo.findLatestByUser(DARLING_USER_ID)).toBeNull()
  })

  it('完了後は新しいバッチを起動できる', async () => {
    await repo.save(completedBatch({ userId: HONEY_USER_ID }))
    await expect(repo.save(startedBatch({ userId: HONEY_USER_ID }))).resolves.toBeUndefined()
  })
})
