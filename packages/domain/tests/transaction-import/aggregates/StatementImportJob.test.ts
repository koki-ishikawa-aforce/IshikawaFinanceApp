import { describe, it, expect } from 'vitest'
import {
  StatementImportJobSchema,
  launchImportJob,
  startImporting,
  completeImportJob,
  type UploadAcceptedJob,
  type FormatValidatingJob,
} from '../../../src/transaction-import/aggregates/StatementImportJob'

function common(fileFormat: 'csv' | 'pdf') {
  return {
    importJobId: 'job_001' as never,
    uploaderUserId: 'user_honey' as never,
    targetMonth: '2026-06' as never,
    fileKind: 'card_statement',
    fileFormat,
    fileRef: 'file_001' as never,
  }
}

describe('StatementImportJob 集約', () => {
  it('アップロード受付済みジョブは parse 成功', () => {
    expect(() =>
      StatementImportJobSchema.parse({
        kind: 'upload_accepted',
        common: common('csv'),
        acceptedAt: new Date(),
      }),
    ).not.toThrow()
  })

  it('CSV ジョブが PDF変換中に居ると parse 失敗（ルーティング不変条件）', () => {
    expect(() =>
      StatementImportJobSchema.parse({
        kind: 'pdf_converting',
        common: common('csv'),
        pdfConversionJobId: 'pdfjob_001' as never,
        conversionStartedAt: new Date(),
      }),
    ).toThrow()
  })

  it('launchImportJob: pdf → PDF変換中 / csv → フォーマット検証中 にルーティング', () => {
    const pdfJob = StatementImportJobSchema.parse({
      kind: 'upload_accepted',
      common: common('pdf'),
      acceptedAt: new Date(),
    }) as UploadAcceptedJob
    const launched = launchImportJob(pdfJob, new Date(), 'pdfjob_001' as never)
    expect(launched.kind).toBe('pdf_converting')

    const csvJob = StatementImportJobSchema.parse({
      kind: 'upload_accepted',
      common: common('csv'),
      acceptedAt: new Date(),
    }) as UploadAcceptedJob
    const validated = launchImportJob(csvJob, new Date())
    expect(validated.kind).toBe('format_validating')
  })

  it('フォーマット検証中 → 取込中 → 完了 の遷移', () => {
    const validating = StatementImportJobSchema.parse({
      kind: 'format_validating',
      common: common('csv'),
      validationStartedAt: new Date(),
    }) as FormatValidatingJob
    const importing = startImporting(validating, new Date())
    expect(importing.kind).toBe('importing')
    const completed = completeImportJob(
      importing,
      {
        newCount: 10,
        autoClassifiedEstimateCount: 7,
        unclassifiedEstimateCount: 3,
        duplicateExcludedCount: 2,
      },
      new Date(),
    )
    expect(completed.kind).toBe('completed')
    expect(completed.summary.newCount).toBe(10)
  })
})
