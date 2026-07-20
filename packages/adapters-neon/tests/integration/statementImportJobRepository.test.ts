import { describe, it, expect } from 'vitest'
import type { ImportJobId, PdfConversionJobId, UploadAcceptedJob } from '@warimaru/domain'
import { startPdfConversion } from '@warimaru/domain'
import { db } from './setup'
import { NeonStatementImportJobRepository } from '../../src/transaction-import/NeonStatementImportJobRepository'
import { NeonCsvImportStatusQuery } from '../../src/transaction-import/NeonCsvImportStatusQuery'
import { newUlid } from '../../src/newId'
import { DARLING_USER_ID, HONEY_USER_ID, ym } from '../helpers/fixtures'
import { completedJob, failedJob, uploadAcceptedJob } from '../helpers/transactionImportFixtures'

const repo = new NeonStatementImportJobRepository(db)

describe('NeonStatementImportJobRepository', () => {
  it('save → findById の往復同一性（upload_accepted / pdf_converting / completed / failed）', async () => {
    const accepted = uploadAcceptedJob({ fileFormat: 'pdf' }) as UploadAcceptedJob
    await repo.save(accepted)
    expect(await repo.findById(accepted.common.importJobId)).toEqual(accepted)

    const converting = startPdfConversion(
      accepted,
      newUlid() as PdfConversionJobId,
      new Date('2026-07-01T00:30:00.000Z'),
    )
    await repo.save(converting)
    expect(await repo.findById(accepted.common.importJobId)).toEqual(converting)

    for (const job of [completedJob(), failedJob()]) {
      await repo.save(job)
      expect(await repo.findById(job.common.importJobId)).toEqual(job)
    }
  })

  it('未知の ID は null', async () => {
    expect(await repo.findById('01HZZZZZZZZZZZZZZZZZZZZZZZ' as ImportJobId)).toBeNull()
  })

  it('findByUserAndMonth は同月の複数ジョブを返す（他ユーザー・他月は除外）', async () => {
    const first = uploadAcceptedJob({ userId: HONEY_USER_ID, targetMonth: ym('2026-06') })
    const second = completedJob({ userId: HONEY_USER_ID, targetMonth: ym('2026-06') })
    await repo.save(first)
    await repo.save(second)
    await repo.save(uploadAcceptedJob({ userId: HONEY_USER_ID, targetMonth: ym('2026-05') }))
    await repo.save(uploadAcceptedJob({ userId: DARLING_USER_ID, targetMonth: ym('2026-06') }))

    const jobs = await repo.findByUserAndMonth(HONEY_USER_ID, ym('2026-06'))
    expect(jobs).toHaveLength(2)
    expect(jobs.map(j => j.common.importJobId).sort()).toEqual(
      [first.common.importJobId, second.common.importJobId].sort(),
    )
  })
})

describe('NeonCsvImportStatusQuery', () => {
  const query = new NeonCsvImportStatusQuery(db)

  it('completed ジョブが複数あれば completedAt 最新の 1 件で View を組む', async () => {
    const older = completedJob({
      targetMonth: ym('2026-06'),
      completedAt: new Date('2026-07-01T01:00:00.000Z'),
    })
    const latest = completedJob({
      targetMonth: ym('2026-06'),
      completedAt: new Date('2026-07-02T01:00:00.000Z'),
    })
    await repo.save(older)
    await repo.save(latest)
    await repo.save(failedJob({ targetMonth: ym('2026-06') }))

    expect(await query.fetchCompletion(HONEY_USER_ID, ym('2026-06'))).toEqual({
      userId: HONEY_USER_ID,
      targetMonth: ym('2026-06'),
      importJobId: latest.common.importJobId,
      completedAt: new Date('2026-07-02T01:00:00.000Z'),
    })
  })

  it('完了ジョブが無ければ null（未完了ジョブのみ / 他ユーザーの完了は対象外）', async () => {
    await repo.save(uploadAcceptedJob({ userId: HONEY_USER_ID, targetMonth: ym('2026-06') }))
    await repo.save(completedJob({ userId: DARLING_USER_ID, targetMonth: ym('2026-06') }))
    expect(await query.fetchCompletion(HONEY_USER_ID, ym('2026-06'))).toBeNull()
  })
})
