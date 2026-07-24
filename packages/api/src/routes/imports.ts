import { Hono } from 'hono'
import { z } from 'zod'
import {
  DailyMailImportBatchSchema,
  ImportBatchIdSchema,
  ImportJobIdSchema,
  InvariantViolationError,
  NotFoundError,
  PdfConversionJobIdSchema,
  PermissionDeniedError,
  StatementFileKindSchema,
  StatementImportJobSchema,
  TransactionCandidateIdSchema,
  TransactionCandidateSchema,
  TransactionIdSchema,
  UploadFileIdSchema,
  YearMonthSchema,
  completeImportJob,
  confirmCandidate,
  createTransaction,
  failImportJob,
  money,
  roleToPersonalExpenseClass,
  startFormatValidation,
  startImporting,
  startPdfConversion,
  updateProcessedCount,
} from '@warimaru/domain'
import type {
  CsvImportStatusQuery,
  DailyMailImportBatchRepository,
  PdfToCsvConverter,
  StatementImportJob,
  StatementImportJobRepository,
  TransactionCandidateRepository,
  TransactionRepository,
  UploadAcceptedJob,
  UserId,
  UserRole,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-neon'
import type { AppEnv } from '../env.js'
import { parseStatementCsv } from '../parse-statement-csv.js'
import { readJsonObjectBody } from '../read-json-object-body.js'

const StatusParamsSchema = z.object({
  month: YearMonthSchema,
})

/** CSV / PDF アップロード共通のフォームフィールド */
const UploadFieldsSchema = z.object({
  targetMonth: YearMonthSchema,
  fileKind: StatementFileKindSchema.default('card_statement'),
})

/** アップロード上限（メモリ上で全文パースするため保護的に制限する） */
const MAX_CSV_FILE_SIZE = 1_000_000

const CsvFileSchema = z
  .instanceof(File, { message: 'file フィールドに CSV ファイルが必要' })
  .refine(file => file.size <= MAX_CSV_FILE_SIZE, 'CSV ファイルは 1MB 以下でなければならない')

/** PDF 上限（base64 化して Anthropic API へ送るため、リクエスト上限 32MB に収まる値で制限する） */
const MAX_PDF_FILE_SIZE = 10_000_000

const PdfFileSchema = z
  .instanceof(File, { message: 'file フィールドに PDF ファイルが必要' })
  .refine(file => file.size <= MAX_PDF_FILE_SIZE, 'PDF ファイルは 10MB 以下でなければならない')

const ConfirmBodySchema = z.object({
  transactionCandidateIds: z.array(TransactionCandidateIdSchema).min(1).optional(),
})

const MailBatchBodySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  // 境界での早期入力検証（不正な期間を 400 で弾く）。一次情報は
  // DailyMailImportBatch の from < to ガード（domain）であり、ここはそれに整合させた
  // 意図的な二重化。ガードを変えるときは両者を揃えること。
  .refine(body => body.from === undefined || body.to === undefined || body.from < body.to, {
    message: 'from は to より前でなければならない',
    path: ['from'],
  })

export interface ImportsRoutesDeps {
  csvImportStatusQuery: CsvImportStatusQuery
  statementImportJobRepository: StatementImportJobRepository
  transactionCandidateRepository: TransactionCandidateRepository
  dailyMailImportBatchRepository: DailyMailImportBatchRepository
  transactionRepository: TransactionRepository
  pdfToCsvConverter: PdfToCsvConverter
  resolveViewerRole: (viewerId: UserId) => Promise<UserRole>
}

function assertJobOwnedByViewer(job: StatementImportJob, viewerId: UserId): void {
  if (job.common.uploaderUserId !== viewerId) {
    throw new PermissionDeniedError('他ユーザーの取込バッチは参照できない')
  }
}

/** ジョブのファイル形式に応じた取込候補の参照（csv → csvFileId / pdf → pdfFileId 一致） */
function findCandidatesForJob(
  repository: TransactionCandidateRepository,
  job: StatementImportJob,
): ReturnType<TransactionCandidateRepository['findByCsvFileId']> {
  return job.common.fileFormat === 'pdf'
    ? repository.findByPdfFileId(job.common.fileRef)
    : repository.findByCsvFileId(job.common.fileRef)
}

export function importsRoutes(deps: ImportsRoutesDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/status', async c => {
    const params = StatusParamsSchema.parse({ month: c.req.query('month') })
    const viewerId = c.get('viewerId')
    const completion = await deps.csvImportStatusQuery.fetchCompletion(viewerId, params.month)
    return c.json({ completion })
  })

  /** CSV アップロード・取込開始（multipart/form-data: file, targetMonth, fileKind） */
  app.post('/csv', async c => {
    const formData = await c.req.parseBody()
    const fields = UploadFieldsSchema.parse({
      targetMonth: formData['targetMonth'],
      fileKind: formData['fileKind'] === undefined ? undefined : formData['fileKind'],
    })
    const file = CsvFileSchema.parse(formData['file'])
    const viewerId = c.get('viewerId')
    const now = new Date()
    const fileRef = UploadFileIdSchema.parse(newUlid())

    const accepted = StatementImportJobSchema.parse({
      kind: 'upload_accepted',
      common: {
        importJobId: ImportJobIdSchema.parse(newUlid()),
        uploaderUserId: viewerId,
        targetMonth: fields.targetMonth,
        fileKind: fields.fileKind,
        fileFormat: 'csv',
        fileRef,
      },
      acceptedAt: now,
    }) as UploadAcceptedJob

    const validating = startFormatValidation(accepted, new Date())
    const parsed = parseStatementCsv(await file.text())
    if (!parsed.ok) {
      const failed = failImportJob(
        validating,
        { kind: 'format_validation_failed', failureDetail: parsed.error, detectedAt: new Date() },
        new Date(),
      )
      await deps.statementImportJobRepository.save(failed)
      return c.json({ job: failed }, 422)
    }

    // 候補生成の途中失敗でもジョブ記録が残るよう、importing 状態を先に永続化する
    let importing = startImporting(validating, new Date())
    await deps.statementImportJobRepository.save(importing)

    const PROGRESS_SAVE_INTERVAL = 10
    let importedCount = 0
    let duplicateExcludedCount = 0
    try {
      for (const row of parsed.rows) {
        const duplicate = await deps.transactionCandidateRepository.findByTripleMatch(
          viewerId,
          row.occurredAt,
          money(row.amount),
          row.merchantName,
        )
        if (duplicate !== null) {
          duplicateExcludedCount++
        } else {
          const candidate = TransactionCandidateSchema.parse({
            kind: 'normal',
            common: {
              transactionCandidateId: TransactionCandidateIdSchema.parse(newUlid()),
              userId: viewerId,
              importSource: { kind: 'csv', csvFileId: fileRef, rowNumber: row.rowNumber },
              merchantName: row.merchantName,
              amount: row.amount,
              occurredAt: row.occurredAt,
            },
          })
          await deps.transactionCandidateRepository.save(candidate)
          importedCount++
        }
        const totalProcessed = importedCount + duplicateExcludedCount
        if (totalProcessed % PROGRESS_SAVE_INTERVAL === 0) {
          importing = updateProcessedCount(importing, totalProcessed)
          await deps.statementImportJobRepository.save(importing)
        }
      }
    } catch (e) {
      const failed = failImportJob(
        importing,
        {
          kind: 'import_error',
          failureDetail: e instanceof Error ? e.message : String(e),
          detectedAt: new Date(),
        },
        new Date(),
      )
      await deps.statementImportJobRepository.save(failed)
      throw e
    }

    const completed = completeImportJob(
      importing,
      {
        newCount: importedCount,
        autoClassifiedEstimateCount: 0,
        unclassifiedEstimateCount: importedCount,
        duplicateExcludedCount,
      },
      new Date(),
    )
    await deps.statementImportJobRepository.save(completed)
    return c.json({ job: completed }, 201)
  })

  /** PDF アップロード・変換・取込開始（multipart/form-data: file, targetMonth, fileKind） */
  app.post('/pdf', async c => {
    const formData = await c.req.parseBody()
    const fields = UploadFieldsSchema.parse({
      targetMonth: formData['targetMonth'],
      fileKind: formData['fileKind'] === undefined ? undefined : formData['fileKind'],
    })
    const file = PdfFileSchema.parse(formData['file'])
    const viewerId = c.get('viewerId')

    // %PDF シグネチャ検証（不正バイナリを Anthropic API へ送る前に弾く。ジョブ生成前なので 400）
    const pdfBytes = new Uint8Array(await file.arrayBuffer())
    const isPdf =
      pdfBytes[0] === 0x25 && pdfBytes[1] === 0x50 && pdfBytes[2] === 0x44 && pdfBytes[3] === 0x46
    if (!isPdf) {
      return c.json({ error: 'file が PDF ではない（%PDF シグネチャ不一致）' }, 400)
    }

    const fileRef = UploadFileIdSchema.parse(newUlid())
    const accepted = StatementImportJobSchema.parse({
      kind: 'upload_accepted',
      common: {
        importJobId: ImportJobIdSchema.parse(newUlid()),
        uploaderUserId: viewerId,
        targetMonth: fields.targetMonth,
        fileKind: fields.fileKind,
        fileFormat: 'pdf',
        fileRef,
      },
      acceptedAt: new Date(),
    }) as UploadAcceptedJob

    // 変換の途中失敗でもジョブ記録が残るよう、pdf_converting 状態を先に永続化する
    const pdfConversionJobId = PdfConversionJobIdSchema.parse(newUlid())
    const converting = startPdfConversion(accepted, pdfConversionJobId, new Date())
    await deps.statementImportJobRepository.save(converting)

    const conversion = await deps.pdfToCsvConverter.convert(pdfBytes)
    if (!conversion.ok) {
      const failed = failImportJob(
        converting,
        {
          kind: 'pdf_conversion_failed',
          reason: conversion.reason,
          failureDetail: conversion.failureDetail,
          detectedAt: new Date(),
        },
        new Date(),
      )
      await deps.statementImportJobRepository.save(failed)
      return c.json({ job: failed, conversionFailureReason: conversion.reason }, 422)
    }

    let importing = startImporting(converting, new Date())
    await deps.statementImportJobRepository.save(importing)

    const PROGRESS_SAVE_INTERVAL = 10
    let importedCount = 0
    let duplicateExcludedCount = 0
    try {
      for (const row of conversion.rows) {
        const duplicate = await deps.transactionCandidateRepository.findByTripleMatch(
          viewerId,
          row.occurredAt,
          money(row.amount),
          row.merchantName,
        )
        if (duplicate !== null) {
          duplicateExcludedCount++
        } else {
          const candidate = TransactionCandidateSchema.parse({
            kind: 'normal',
            common: {
              transactionCandidateId: TransactionCandidateIdSchema.parse(newUlid()),
              userId: viewerId,
              importSource: {
                kind: 'pdf',
                pdfFileId: fileRef,
                pageNumber: row.pageNumber,
                pdfConversionJobId,
              },
              merchantName: row.merchantName,
              amount: row.amount,
              occurredAt: row.occurredAt,
            },
          })
          await deps.transactionCandidateRepository.save(candidate)
          importedCount++
        }
        const totalProcessed = importedCount + duplicateExcludedCount
        if (totalProcessed % PROGRESS_SAVE_INTERVAL === 0) {
          importing = updateProcessedCount(importing, totalProcessed)
          await deps.statementImportJobRepository.save(importing)
        }
      }
    } catch (e) {
      const failed = failImportJob(
        importing,
        {
          kind: 'import_error',
          failureDetail: e instanceof Error ? e.message : String(e),
          detectedAt: new Date(),
        },
        new Date(),
      )
      await deps.statementImportJobRepository.save(failed)
      throw e
    }

    const completed = completeImportJob(
      importing,
      {
        newCount: importedCount,
        autoClassifiedEstimateCount: 0,
        unclassifiedEstimateCount: importedCount,
        duplicateExcludedCount,
      },
      new Date(),
    )
    await deps.statementImportJobRepository.save(completed)
    return c.json({ job: completed, pdfConversionJobId }, 201)
  })

  /** 取込候補の一覧取得 */
  app.get('/:importJobId/candidates', async c => {
    const importJobId = ImportJobIdSchema.parse(c.req.param('importJobId'))
    const viewerId = c.get('viewerId')
    const job = await deps.statementImportJobRepository.findById(importJobId)
    if (job === null) throw new NotFoundError('StatementImportJob', importJobId)
    assertJobOwnedByViewer(job, viewerId)
    const candidates = await findCandidatesForJob(deps.transactionCandidateRepository, job)
    return c.json({ importJobId, jobKind: job.kind, candidates })
  })

  /** 取込候補の確定（候補から未分類取引を生成） */
  app.put('/:importJobId/confirm', async c => {
    const importJobId = ImportJobIdSchema.parse(c.req.param('importJobId'))
    const rawBody = await c.req.text()
    const body = ConfirmBodySchema.parse(readJsonObjectBody(rawBody))
    const viewerId = c.get('viewerId')
    const job = await deps.statementImportJobRepository.findById(importJobId)
    if (job === null) throw new NotFoundError('StatementImportJob', importJobId)
    assertJobOwnedByViewer(job, viewerId)
    if (job.kind !== 'completed') {
      throw new InvariantViolationError(
        `取込が完了していないバッチは確定できない（現状態: ${job.kind}）`,
      )
    }

    const all = await findCandidatesForJob(deps.transactionCandidateRepository, job)
    const targetIds = body.transactionCandidateIds
    const targets =
      targetIds === undefined
        ? all
        : all.filter(candidate => targetIds.includes(candidate.common.transactionCandidateId))

    // 冪等性: 確定済み候補はスキップし、取引 ID は候補 ULID を決定的に再利用する。
    // 「取引 upsert → 候補 confirmed 保存」の間でクラッシュしても、再実行は
    // 同一 PK への upsert となり取引が重複しない。
    const confirmable = targets.filter(candidate => candidate.kind !== 'confirmed')
    const alreadyConfirmedCount = targets.length - confirmable.length

    const defaultExpenseClass = roleToPersonalExpenseClass(await deps.resolveViewerRole(viewerId))
    const now = new Date()
    let confirmedCount = 0
    for (const candidate of confirmable) {
      const transactionId = TransactionIdSchema.parse(candidate.common.transactionCandidateId)
      const transaction = createTransaction({
        kind: 'unclassified',
        common: {
          transactionId,
          ownerUserId: viewerId,
          merchantName: candidate.common.merchantName,
          amount: candidate.common.amount,
          occurredAt: candidate.common.occurredAt,
          importSource: candidate.common.importSource,
        },
        reason: 'merchant_rule_unlearned',
        defaultExpenseClass,
      })
      await deps.transactionRepository.save(transaction)
      await deps.transactionCandidateRepository.save(
        confirmCandidate(candidate, transactionId, now),
      )
      confirmedCount++
    }
    return c.json({ importJobId, confirmedCount, alreadyConfirmedCount, confirmedAt: now })
  })

  /** メール取込バッチの手動トリガー（EventBridge 連携前の手動実行用） */
  app.post('/mail-batch', async c => {
    const rawBody = await c.req.text()
    const body = MailBatchBodySchema.parse(readJsonObjectBody(rawBody))
    const viewerId = c.get('viewerId')
    const inProgress = await deps.dailyMailImportBatchRepository.findInProgressByUser(viewerId)
    if (inProgress !== null) {
      throw new InvariantViolationError(
        `進行中のメール取込バッチが既に存在する: ${inProgress.common.importBatchId}`,
      )
    }
    const now = new Date()
    const to = body.to ?? now
    const from = body.from ?? new Date(to.getTime() - 24 * 60 * 60 * 1000)
    const batch = DailyMailImportBatchSchema.parse({
      kind: 'started',
      common: {
        importBatchId: ImportBatchIdSchema.parse(newUlid()),
        userId: viewerId,
        launchedAt: now,
        targetPeriod: { from, to },
      },
    })
    await deps.dailyMailImportBatchRepository.save(batch)
    // 実際のメール取得・候補生成はバッチワーカー側の責務（本 API は起動記録のみ）
    return c.json({ batch }, 202)
  })

  return app
}
