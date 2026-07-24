/**
 * 明細取込ジョブ集約（取引取込コンテキスト）
 * @see docs/domain/08a-ul-取引取込.md §1
 * @see docs/domain/09-aggregates.md #3
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.3
 *
 * kawasima: data 明細取込ジョブ = アップロード受付済み OR PDF変換中 OR フォーマット検証中 OR
 *   取込中 OR 完了 OR 失敗
 *
 * 不変条件:
 *  - PDF → CSV 変換中は同一ジョブID で二重変換が発生しない（Repository で保証、Phase 5 M-B）
 *  - 状態遷移は単方向（後戻りなし、後戻り遷移関数を提供しない）
 *  - PDF変換中はファイル形式が pdf のジョブに限る（superRefine）
 *  - ルーティング: ファイル形式 pdf → PDF変換中（startPdfConversion、PDF変換ジョブID 必須）、
 *    csv → フォーマット検証中（startFormatValidation）
 */
import { z } from 'zod'
import {
  ImportJobIdSchema,
  UserIdSchema,
  UploadFileIdSchema,
  PdfConversionJobIdSchema,
  type PdfConversionJobId,
} from '../../shared/ids'
import { YearMonthSchema } from '../../shared/value-objects/YearMonth'
import {
  ImportResultSummarySchema,
  type ImportResultSummary,
} from '../value-objects/ImportResultSummary'
import {
  ImportJobFailureReasonSchema,
  type ImportJobFailureReason,
} from '../value-objects/ImportJobFailureReason'

/** ファイル種別（カード明細 OR 銀行明細） */
export const StatementFileKindSchema = z.enum(['card_statement', 'bank_statement'])
export type StatementFileKind = z.infer<typeof StatementFileKindSchema>

/** アップロードファイル形式 */
export const UploadFileFormatSchema = z.enum(['csv', 'pdf'])
export type UploadFileFormat = z.infer<typeof UploadFileFormatSchema>

/** 共通属性 */
export const CommonImportJobAttrsSchema = z.object({
  importJobId: ImportJobIdSchema,
  uploaderUserId: UserIdSchema,
  targetMonth: YearMonthSchema,
  fileKind: StatementFileKindSchema,
  fileFormat: UploadFileFormatSchema,
  fileRef: UploadFileIdSchema,
})
export type CommonImportJobAttrs = z.infer<typeof CommonImportJobAttrsSchema>

export const StatementImportJobSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('upload_accepted'),
      common: CommonImportJobAttrsSchema,
      acceptedAt: z.date(),
    }),
    z.object({
      kind: z.literal('pdf_converting'),
      common: CommonImportJobAttrsSchema,
      pdfConversionJobId: PdfConversionJobIdSchema,
      conversionStartedAt: z.date(),
    }),
    z.object({
      kind: z.literal('format_validating'),
      common: CommonImportJobAttrsSchema,
      validationStartedAt: z.date(),
    }),
    z.object({
      kind: z.literal('importing'),
      common: CommonImportJobAttrsSchema,
      importStartedAt: z.date(),
      processedCount: z.number().int().nonnegative(),
    }),
    z.object({
      kind: z.literal('completed'),
      common: CommonImportJobAttrsSchema,
      completedAt: z.date(),
      summary: ImportResultSummarySchema,
    }),
    z.object({
      kind: z.literal('failed'),
      common: CommonImportJobAttrsSchema,
      failedAt: z.date(),
      failureReason: ImportJobFailureReasonSchema,
    }),
  ])
  .superRefine((job, ctx) => {
    if (job.kind === 'pdf_converting' && job.common.fileFormat !== 'pdf') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'PDF変換中に遷移できるのはファイル形式 pdf のジョブのみ',
        path: ['common', 'fileFormat'],
      })
    }
  })
export type StatementImportJob = z.infer<typeof StatementImportJobSchema>

export type UploadAcceptedJob = Extract<StatementImportJob, { kind: 'upload_accepted' }>
export type PdfConvertingJob = Extract<StatementImportJob, { kind: 'pdf_converting' }>
export type FormatValidatingJob = Extract<StatementImportJob, { kind: 'format_validating' }>
export type ImportingJob = Extract<StatementImportJob, { kind: 'importing' }>
export type CompletedJob = Extract<StatementImportJob, { kind: 'completed' }>
export type FailedJob = Extract<StatementImportJob, { kind: 'failed' }>

/**
 * 状態遷移: アップロード受付済み（pdf）→ PDF変換中
 * PDF変換ジョブID を型レベルで必須にする（csv ジョブは superRefine が拒否）。
 */
export function startPdfConversion(
  job: UploadAcceptedJob,
  pdfConversionJobId: PdfConversionJobId,
  at: Date,
): PdfConvertingJob {
  return StatementImportJobSchema.parse({
    kind: 'pdf_converting',
    common: job.common,
    pdfConversionJobId,
    conversionStartedAt: at,
  }) as PdfConvertingJob
}

/** 状態遷移: アップロード受付済み（csv）→ フォーマット検証中 */
export function startFormatValidation(job: UploadAcceptedJob, at: Date): FormatValidatingJob {
  return StatementImportJobSchema.parse({
    kind: 'format_validating',
    common: job.common,
    validationStartedAt: at,
  }) as FormatValidatingJob
}

/** 状態遷移: PDF変換中/フォーマット検証中 → 取込中 */
export function startImporting(
  job: PdfConvertingJob | FormatValidatingJob,
  at: Date,
): ImportingJob {
  return StatementImportJobSchema.parse({
    kind: 'importing',
    common: job.common,
    importStartedAt: at,
    processedCount: 0,
  }) as ImportingJob
}

/** 取込中ジョブの処理済み件数を更新する（同一状態内の属性更新） */
export function updateProcessedCount(job: ImportingJob, processedCount: number): ImportingJob {
  return StatementImportJobSchema.parse({
    ...job,
    processedCount,
  }) as ImportingJob
}

/** 状態遷移: 取込中 → 完了（終端） */
export function completeImportJob(
  job: ImportingJob,
  summary: ImportResultSummary,
  at: Date,
): CompletedJob {
  return StatementImportJobSchema.parse({
    kind: 'completed',
    common: job.common,
    completedAt: at,
    summary,
  }) as CompletedJob
}

/** 状態遷移: 非終端状態 → 失敗（終端） */
export function failImportJob(
  job: UploadAcceptedJob | PdfConvertingJob | FormatValidatingJob | ImportingJob,
  failureReason: ImportJobFailureReason,
  at: Date,
): FailedJob {
  return StatementImportJobSchema.parse({
    kind: 'failed',
    common: job.common,
    failedAt: at,
    failureReason,
  }) as FailedJob
}
