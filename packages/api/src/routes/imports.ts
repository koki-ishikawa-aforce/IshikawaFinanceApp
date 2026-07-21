import { Hono } from 'hono'
import { z } from 'zod'
import {
  DailyMailImportBatchSchema,
  ImportBatchIdSchema,
  ImportJobIdSchema,
  InvariantViolationError,
  NotFoundError,
  PermissionDeniedError,
  StatementFileKindSchema,
  StatementImportJobSchema,
  TransactionCandidateIdSchema,
  TransactionCandidateSchema,
  TransactionIdSchema,
  UploadFileIdSchema,
  YearMonthSchema,
  completeImportJob,
  createTransaction,
  failImportJob,
  money,
  startFormatValidation,
  startImporting,
} from '@warimaru/domain'
import type {
  CsvImportStatusQuery,
  DailyMailImportBatchRepository,
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
import { roleToPersonalExpenseClass } from '../role-mapping.js'

const StatusParamsSchema = z.object({
  month: YearMonthSchema,
})

const CsvUploadFieldsSchema = z.object({
  targetMonth: YearMonthSchema,
  fileKind: StatementFileKindSchema.default('card_statement'),
})

const ConfirmBodySchema = z.object({
  transactionCandidateIds: z.array(TransactionCandidateIdSchema).min(1).optional(),
})

const MailBatchBodySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

export interface ImportsRoutesDeps {
  csvImportStatusQuery: CsvImportStatusQuery
  statementImportJobRepository: StatementImportJobRepository
  transactionCandidateRepository: TransactionCandidateRepository
  dailyMailImportBatchRepository: DailyMailImportBatchRepository
  transactionRepository: TransactionRepository
  resolveViewerRole: (viewerId: UserId) => Promise<UserRole>
}

function assertJobOwnedByViewer(job: StatementImportJob, viewerId: UserId): void {
  if (job.common.uploaderUserId !== viewerId) {
    throw new PermissionDeniedError('他ユーザーの取込バッチは参照できない')
  }
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
    const fields = CsvUploadFieldsSchema.parse({
      targetMonth: formData['targetMonth'],
      fileKind: formData['fileKind'] === undefined ? undefined : formData['fileKind'],
    })
    const file = formData['file']
    if (!(file instanceof File)) {
      throw new InvariantViolationError('file フィールドに CSV ファイルが必要')
    }
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

    const importing = startImporting(validating, new Date())
    let importedCount = 0
    let duplicateExcludedCount = 0
    for (const row of parsed.rows) {
      const duplicate = await deps.transactionCandidateRepository.findByTripleMatch(
        viewerId,
        row.occurredAt,
        money(row.amount),
        row.merchantName,
      )
      if (duplicate !== null) {
        duplicateExcludedCount++
        continue
      }
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

  /** 取込候補の一覧取得 */
  app.get('/:batchId/candidates', async c => {
    const importJobId = ImportJobIdSchema.parse(c.req.param('batchId'))
    const viewerId = c.get('viewerId')
    const job = await deps.statementImportJobRepository.findById(importJobId)
    if (job === null) throw new NotFoundError('StatementImportJob', importJobId)
    assertJobOwnedByViewer(job, viewerId)
    const candidates = await deps.transactionCandidateRepository.findByCsvFileId(job.common.fileRef)
    return c.json({ importJobId, jobKind: job.kind, candidates })
  })

  /** 取込候補の確定（候補から未分類取引を生成） */
  app.put('/:batchId/confirm', async c => {
    const importJobId = ImportJobIdSchema.parse(c.req.param('batchId'))
    const rawBody = await c.req.text()
    const body = ConfirmBodySchema.parse(rawBody.length > 0 ? JSON.parse(rawBody) : {})
    const viewerId = c.get('viewerId')
    const job = await deps.statementImportJobRepository.findById(importJobId)
    if (job === null) throw new NotFoundError('StatementImportJob', importJobId)
    assertJobOwnedByViewer(job, viewerId)
    if (job.kind !== 'completed') {
      throw new InvariantViolationError(
        `取込が完了していないバッチは確定できない（現状態: ${job.kind}）`,
      )
    }

    const all = await deps.transactionCandidateRepository.findByCsvFileId(job.common.fileRef)
    const targetIds = body.transactionCandidateIds
    const targets =
      targetIds === undefined
        ? all
        : all.filter(candidate => targetIds.includes(candidate.common.transactionCandidateId))

    const defaultExpenseClass = roleToPersonalExpenseClass(await deps.resolveViewerRole(viewerId))
    const now = new Date()
    let confirmedCount = 0
    for (const candidate of targets) {
      const transaction = createTransaction({
        kind: 'unclassified',
        common: {
          transactionId: TransactionIdSchema.parse(newUlid()),
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
      confirmedCount++
    }
    return c.json({ importJobId, confirmedCount, confirmedAt: now })
  })

  /** メール取込バッチの手動トリガー（EventBridge 連携前の手動実行用） */
  app.post('/mail-batch', async c => {
    const rawBody = await c.req.text()
    const body = MailBatchBodySchema.parse(rawBody.length > 0 ? JSON.parse(rawBody) : {})
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
