import { Hono } from 'hono'
import { z } from 'zod'
import {
  CsvImportCompletedSchema,
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
  judgeManualMailImportCooldown,
  money,
  roleToPersonalExpenseClass,
  startFormatValidation,
  startImporting,
  startPdfConversion,
  updateProcessedCount,
} from '@warimaru/domain'
import type {
  CsvImportStatusQuery,
  PdfToCsvConverter,
  StatementImportJob,
  StatementImportJobRepository,
  TransactionCandidateRepository,
  TransactionRepository,
  UploadAcceptedJob,
  UserId,
  UserRole,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-postgres'
import type { AppEnv } from '../env.js'
import { domainEventBase } from '../event-handlers/index.js'
import {
  DEFAULT_MAIL_SCAN_DAYS,
  runDailyMailImportForUser,
  type DailyMailImportDeps,
} from '../daily-mail-import.js'
import { parseStatementCsv } from '../parse-statement-csv.js'
import { readFormBody, readJsonObjectBody } from '../read-request-body.js'

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

/**
 * 手動実行で指定できる取込対象期間の上限。Gmail の取得は 1 回 500 件が上限（#412）で、
 * 長期間を指定すると上限超過で必ず失敗する。失敗してから気づくより、受け付けない側に倒す。
 */
const MAX_MAIL_BATCH_PERIOD_DAYS = 31

const MailBatchBodySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

/** メール取込バッチの手動トリガーは日次ワーカーと同じ経路を通すため、その依存を引き継ぐ */
export interface ImportsRoutesDeps extends DailyMailImportDeps {
  csvImportStatusQuery: CsvImportStatusQuery
  statementImportJobRepository: StatementImportJobRepository
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
    const formData = await readFormBody(() => c.req.parseBody())
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
    const formData = await readFormBody(() => c.req.parseBody())
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
      // reason は画面が文言を選ぶための機械可読な理由。同じ 400 でもサイズ超過等の
      // ZodError 由来（error-handler の Validation error）とは区別できるようにする
      return c.json(
        { error: 'file が PDF ではない（%PDF シグネチャ不一致）', reason: 'not_a_pdf' },
        400,
      )
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

    if (confirmedCount > 0) {
      await deps.eventBus.publish(
        CsvImportCompletedSchema.parse({
          ...domainEventBase(now),
          type: 'CsvImportCompleted',
          importJobId,
          userId: viewerId,
          summary: job.summary,
          targetYearMonths: [job.common.targetMonth],
        }),
      )
    }

    return c.json({ importJobId, confirmedCount, alreadyConfirmedCount, confirmedAt: now })
  })

  /**
   * メール取込バッチの手動トリガー（EventBridge → Lambda の配線（#416）前の手動実行用）
   *
   * 起動記録を残すだけでなく、取得 → 重複除外 → パース → 候補生成 → 完了 まで進めてから
   * 結果を返す（進行は `runDailyMailImportForUser` が持つ）。Gmail の取得と保存を待つため
   * 応答までに数分かかりうる。日次の自動実行はスケジューラ側から同じ関数を呼ぶ。
   *
   * 取込対象期間は既定で「過去 5 日から現在まで」（論点22 / OQ-31）。from / to を渡すと
   * その期間で実行する。期間の上限を `MAX_MAIL_BATCH_PERIOD_DAYS` に置いているのは、
   * 手で長期間を指定すると Gmail の取得件数上限に当たって毎回失敗するため。
   *
   * 取込が失敗した場合は成功と同じ 200 では返さない（呼び出した人が「取り込めた」と
   * 受け取ってしまう）。Gmail の連携が切れているなら再認可が要るので 409、外部の障害なら
   * 時間をおいて再実行すれば直りうるので 502 を返す。結末の詳細は `result` に入る。
   * 連携がそもそも無い場合はバッチを起動しないため 409 で `batch` は null になる（#488）。
   *
   * 直近の実行から `MANUAL_MAIL_IMPORT_COOLDOWN_MS` 未満なら取込を始めず 429 を返す（#489）。
   * 応答を待てずに叩き直された実行が、前の実行が進めているバッチを引き継いで同じ記録を
   * 同時に書き換えるのを防ぐ。クールダウンを過ぎていれば、途中で落ちた取込の引き継ぎは
   * これまでどおり行う。直近の実行が失敗（終端）で終わっている場合はこの間隔を待たずに
   * 即座に受け付ける（もう動いていないことが確定しているため。#628）。日次の自動起動は
   * この経路を通らないため制限を受けない。
   */
  app.post('/mail-batch', async c => {
    const rawBody = await c.req.text()
    const body = MailBatchBodySchema.parse(readJsonObjectBody(rawBody))
    const viewerId = c.get('viewerId')
    // 期間の from < to ガードは domain の DailyMailImportBatchSchema が単一ソース。
    // ワーカーが進行中バッチの照会（DB 参照）より前に同スキーマで parse するため、不正な
    // 期間はここでも 400 で早期に弾かれる（ガードを API 側で再実装しない）
    // 片方だけ指定されたときは、もう片方を既定の走査幅（過去 5 日）から補う
    const period =
      body.from === undefined && body.to === undefined
        ? undefined
        : {
            from:
              body.from ??
              new Date(
                (body.to ?? new Date()).getTime() - DEFAULT_MAIL_SCAN_DAYS * 24 * 60 * 60 * 1000,
              ),
            to: body.to ?? new Date(),
          }
    if (
      period !== undefined &&
      period.to.getTime() - period.from.getTime() > MAX_MAIL_BATCH_PERIOD_DAYS * 24 * 60 * 60 * 1000
    ) {
      return c.json(
        {
          error: `取込対象期間は ${MAX_MAIL_BATCH_PERIOD_DAYS} 日以内でなければならない`,
          reason: 'period_too_long',
        },
        400,
      )
    }
    // 直近の実行からクールダウンを空ける（#489）。判定そのものはドメインが持ち、ここは
    // 直近バッチを引いて結果を HTTP に写すだけにする
    const latestBatch = await deps.dailyMailImportBatchRepository.findLatestByUser(viewerId)
    const cooldown = judgeManualMailImportCooldown(latestBatch, new Date())
    if (cooldown.kind === 'cooling_down') {
      // 429（時間をおけば受け付ける）。連携切れの 409 とは違い、利用者に操作は要らない。
      // 秒は切り上げる — Retry-After の秒数を待って叩き直したときに、まだ足りずに
      // もう一度弾かれることがないようにする
      const retryAfterSeconds = Math.ceil(cooldown.retryAfterMs / 1000)
      const waitMinutes = Math.ceil(retryAfterSeconds / 60)
      // 進行中と終端で理由が違う。終端のバッチしか無いのに「まだ動いている」と返すと、
      // 完了サマリを見たあとの利用者には事実と食い違う案内になる
      const stillRunning =
        cooldown.latestBatchKind === 'started' || cooldown.latestBatchKind === 'importing'
      // 弾いたことを運用側にも残す（「取込が動かない」と言われたときに切り分けられるように）。
      // 出すのはバッチ ID と状態だけで、ユーザーID・メール本文・金額は出さない
      console.info(
        '[transaction-import] 手動のメール取込をクールダウンで受け付けなかった' +
          `（importBatchId=${latestBatch?.common.importBatchId ?? 'unknown'}, ` +
          `kind=${cooldown.latestBatchKind}, retryAfter=${retryAfterSeconds}s）`,
      )
      return c.json(
        {
          error: stillRunning
            ? `前のメール取込がまだ動いている。約 ${waitMinutes} 分後に実行する`
            : `直前のメール取込から間隔が空いていない。約 ${waitMinutes} 分後に実行する`,
          reason: 'cooling_down',
          retryAfterSeconds,
        },
        429,
        { 'Retry-After': String(retryAfterSeconds) },
      )
    }
    const result = await runDailyMailImportForUser(deps, {
      userId: viewerId,
      ...(period === undefined ? {} : { period }),
    })
    if (result.status === 'not_launched') {
      // Gmail 連携が無いので取込は起動していない。再認可は利用者の操作待ちなので 409。
      // バッチ記録を残さない結末なので `batch` は無い（OQ-57 / #488）
      return c.json({ batch: null, result }, 409)
    }
    const batch = await deps.dailyMailImportBatchRepository.findById(result.importBatchId)
    if (result.status === 'failed') {
      // 取得の途中で失効を検知した場合は再認可が要る（利用者の操作待ち）ので 409、
      // それ以外は外部の取得・保存の失敗なので 502
      const status = result.failureKind === 'oauth_revocation_detected' ? 409 : 502
      return c.json({ batch, result }, status)
    }
    return c.json({ batch, result })
  })

  return app
}
