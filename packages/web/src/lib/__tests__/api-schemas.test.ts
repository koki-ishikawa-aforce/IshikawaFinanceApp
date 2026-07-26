/**
 * ワイヤー形式スキーマがサーバーの応答形と一致していることを固定する。
 * フィールド名がずれても Zod は `undefined` にするだけで例外にならず、
 * 画面から情報が静かに消えるため、実 API の応答例そのままを通す。
 * 期待値は `packages/api/tests/routes/imports.test.ts` の応答形に揃える。
 */
import { describe, expect, it } from 'vitest'
import { ImportUploadResponseSchema } from '../api-schemas'

describe('ImportUploadResponseSchema', () => {
  it('PDF 変換失敗（422）の応答から構造化理由を取り出せる', () => {
    const parsed = ImportUploadResponseSchema.parse({
      job: {
        kind: 'failed',
        common: {
          importJobId: '01JOB',
          uploaderUserId: 'U_DARLING',
          targetMonth: '2026-06',
          fileKind: 'card_statement',
          fileFormat: 'pdf',
          fileRef: '01FILE',
        },
        failedAt: '2026-06-30T12:00:00.000Z',
        failureReason: {
          kind: 'pdf_conversion_failed',
          reason: 'row_count_mismatch',
          failureDetail: '明細行数が一致しない（抽出 1 行 / 記載 2 行）',
          detectedAt: '2026-06-30T12:00:00.000Z',
        },
      },
      conversionFailureReason: 'row_count_mismatch',
    })

    expect(parsed.job.kind).toBe('failed')
    expect(parsed.job.failureReason).toEqual({
      kind: 'pdf_conversion_failed',
      reason: 'row_count_mismatch',
      failureDetail: '明細行数が一致しない（抽出 1 行 / 記載 2 行）',
    })
  })

  it('CSV 形式検証失敗（422）の応答を構造化理由なしで受ける', () => {
    const parsed = ImportUploadResponseSchema.parse({
      job: {
        kind: 'failed',
        common: {
          importJobId: '01JOB',
          targetMonth: '2026-06',
          fileKind: 'card_statement',
          fileFormat: 'csv',
          fileRef: '01FILE',
        },
        failedAt: '2026-06-30T12:00:00.000Z',
        failureReason: {
          kind: 'format_validation_failed',
          failureDetail: '2 行目: 列数が不足している（日付,店名,金額 が必要）',
          detectedAt: '2026-06-30T12:00:00.000Z',
        },
      },
    })

    expect(parsed.job.failureReason?.kind).toBe('format_validation_failed')
    expect(parsed.job.failureReason?.reason).toBeUndefined()
  })

  it('取込完了（201）の応答から件数サマリを取り出せる', () => {
    const parsed = ImportUploadResponseSchema.parse({
      job: {
        kind: 'completed',
        common: {
          importJobId: '01JOB',
          targetMonth: '2026-06',
          fileKind: 'card_statement',
          fileFormat: 'pdf',
          fileRef: '01FILE',
        },
        completedAt: '2026-06-30T12:00:00.000Z',
        summary: {
          newCount: 2,
          autoClassifiedEstimateCount: 0,
          unclassifiedEstimateCount: 2,
          duplicateExcludedCount: 1,
        },
      },
      pdfConversionJobId: '01PDFJOB',
    })

    expect(parsed.job.summary?.newCount).toBe(2)
    expect(parsed.job.summary?.duplicateExcludedCount).toBe(1)
    expect(parsed.job.failureReason).toBeUndefined()
  })

  it('未知の失敗種別は取込中エラーとして受ける（画面を落とさない）', () => {
    const parsed = ImportUploadResponseSchema.parse({
      job: {
        kind: 'failed',
        common: {
          importJobId: '01JOB',
          targetMonth: '2026-06',
          fileKind: 'card_statement',
          fileFormat: 'csv',
          fileRef: '01FILE',
        },
        failedAt: '2026-06-30T12:00:00.000Z',
        failureReason: {
          kind: 'future_failure_kind',
          failureDetail: '将来追加された理由',
          detectedAt: '2026-06-30T12:00:00.000Z',
        },
      },
    })

    expect(parsed.job.failureReason?.kind).toBe('import_error')
  })
})
