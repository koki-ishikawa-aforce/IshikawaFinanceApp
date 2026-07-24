import { describe, it, expect } from 'vitest'
import {
  StatementImportJobSchema,
  startPdfConversion,
  startFormatValidation,
  startImporting,
  updateProcessedCount,
  completeImportJob,
  failImportJob,
  type UploadAcceptedJob,
  type FormatValidatingJob,
} from '../../../src/transaction-import/aggregates/StatementImportJob'

function common(fileFormat: 'csv' | 'pdf') {
  return {
    importJobId: '01JB0000000000000000000001' as never,
    uploaderUserId: 'user_honey' as never,
    targetMonth: '2026-06' as never,
    fileKind: 'card_statement',
    fileFormat,
    fileRef: '01F10000000000000000000001' as never,
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
        pdfConversionJobId: '01PDF000000000000000000001' as never,
        conversionStartedAt: new Date(),
      }),
    ).toThrow()
  })

  it('startPdfConversion: pdf → PDF変換中 / startFormatValidation: csv → フォーマット検証中', () => {
    const pdfJob = StatementImportJobSchema.parse({
      kind: 'upload_accepted',
      common: common('pdf'),
      acceptedAt: new Date(),
    }) as UploadAcceptedJob
    const converting = startPdfConversion(pdfJob, '01PDF000000000000000000001' as never, new Date())
    expect(converting.kind).toBe('pdf_converting')
    expect(converting.pdfConversionJobId).toBe('01PDF000000000000000000001')

    const csvJob = StatementImportJobSchema.parse({
      kind: 'upload_accepted',
      common: common('csv'),
      acceptedAt: new Date(),
    }) as UploadAcceptedJob
    const validated = startFormatValidation(csvJob, new Date())
    expect(validated.kind).toBe('format_validating')
  })

  it('startPdfConversion: csv ジョブは parse 失敗（ルーティング不変条件）', () => {
    const csvJob = StatementImportJobSchema.parse({
      kind: 'upload_accepted',
      common: common('csv'),
      acceptedAt: new Date(),
    }) as UploadAcceptedJob
    expect(() =>
      startPdfConversion(csvJob, '01PDF000000000000000000001' as never, new Date()),
    ).toThrow()
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

  it('updateProcessedCount: 取込中ジョブの処理済み件数を更新できる', () => {
    const validating = StatementImportJobSchema.parse({
      kind: 'format_validating',
      common: common('csv'),
      validationStartedAt: new Date(),
    }) as FormatValidatingJob
    const importing = startImporting(validating, new Date())
    expect(importing.processedCount).toBe(0)

    const updated = updateProcessedCount(importing, 15)
    expect(updated.kind).toBe('importing')
    expect(updated.processedCount).toBe(15)
    expect(updated.common).toEqual(importing.common)
    expect(updated.importStartedAt).toEqual(importing.importStartedAt)
  })

  it('updateProcessedCount: 負数は parse 失敗（nonnegative 不変条件）', () => {
    const validating = StatementImportJobSchema.parse({
      kind: 'format_validating',
      common: common('csv'),
      validationStartedAt: new Date(),
    }) as FormatValidatingJob
    const importing = startImporting(validating, new Date())
    expect(() => updateProcessedCount(importing, -1)).toThrow()
  })

  it('failImportJob: PDF変換失敗は構造化された reason を保持する（#61）', () => {
    const converting = startPdfConversion(
      StatementImportJobSchema.parse({
        kind: 'upload_accepted',
        common: common('pdf'),
        acceptedAt: new Date(),
      }) as UploadAcceptedJob,
      '01PDF000000000000000000001' as never,
      new Date(),
    )
    const failed = failImportJob(
      converting,
      {
        kind: 'pdf_conversion_failed',
        reason: 'total_amount_mismatch',
        failureDetail: '利用金額合計が一致しない',
        detectedAt: new Date(),
      },
      new Date(),
    )
    expect(failed.kind).toBe('failed')
    expect(failed.failureReason.kind).toBe('pdf_conversion_failed')
    if (failed.failureReason.kind === 'pdf_conversion_failed') {
      expect(failed.failureReason.reason).toBe('total_amount_mismatch')
    }
  })

  it('pdf_conversion_failed の失敗理由に reason がないと parse 失敗（不変条件）', () => {
    expect(() =>
      StatementImportJobSchema.parse({
        kind: 'failed',
        common: common('pdf'),
        failedAt: new Date(),
        failureReason: {
          kind: 'pdf_conversion_failed',
          failureDetail: '変換に失敗',
          detectedAt: new Date(),
        },
      }),
    ).toThrow()
  })
})
