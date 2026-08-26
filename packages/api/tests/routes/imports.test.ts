import { describe, it, expect } from 'vitest'
import {
  DailyMailImportBatchSchema,
  GmailMessageIdSchema,
  GmailOAuthTokenSchema,
  SmbcMailParseResultSchema,
  YearMonthSchema,
  money,
  type PdfToCsvConversion,
  type SmbcNotificationMailBody,
} from '@warimaru/domain'
import { createApp } from '../../src/app.js'
import { createMockDeps } from '../../src/composition-root.js'
import { createTestApp, request, VIEWER_ID } from '../helpers/test-app.js'

const CSV = '2026/07/05,スーパーA,1200\n2026/07/06,コンビニB,300\n'

const MAIL_OCCURRED_AT = new Date('2026-07-09T12:34:00+09:00')

function mailBody(id: string): SmbcNotificationMailBody {
  return {
    gmailMessageId: GmailMessageIdSchema.parse(id),
    receivedAt: MAIL_OCCURRED_AT,
    subject: 'ご利用のお知らせ【三井住友カード】',
    body: '本文',
    kindHint: 'card_usage',
  }
}

/** 前回の実行が取込中のまま残したバッチ（再開の検証用） */
function leftoverImportingBatch() {
  return DailyMailImportBatchSchema.parse({
    kind: 'importing',
    common: {
      importBatchId: '01BATCH0000000000000000000',
      userId: VIEWER_ID,
      launchedAt: new Date('2026-07-09T00:00:00Z'),
      targetPeriod: {
        from: new Date('2026-07-04T00:00:00Z'),
        to: new Date('2026-07-09T00:00:00Z'),
      },
    },
    importStartedAt: new Date('2026-07-09T00:00:00Z'),
    importedCount: 0,
  })
}

/** クールダウン検証用のバッチ。時刻は「いま」に寄せる（ルートは実時刻でクールダウンを測る） */
function recentBatch(kind: 'completed' | 'importing', now: Date = new Date()) {
  const common = {
    importBatchId: '01BATCH0000000000000000001',
    userId: VIEWER_ID,
    launchedAt: new Date(now.getTime() - 60_000),
    targetPeriod: {
      from: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
      to: new Date(now.getTime() - 60_000),
    },
  }
  return DailyMailImportBatchSchema.parse(
    kind === 'completed'
      ? {
          kind: 'completed',
          common,
          completedAt: now,
          importedCount: 1,
          duplicateExcludedCount: 0,
          failedCount: 0,
        }
      : { kind: 'importing', common, importStartedAt: now, importedCount: 0 },
  )
}

/**
 * Gmail 連携済みで、指定したメールを返す取込経路のアプリ。
 * 既定のモックは取得 0 件・パース未実装で 1 件も取り込めないため、そのままでは候補生成が
 * 壊れても気づけない（ルートの検証としては「取り込めること」まで見たい）。
 */
async function authorizedMailBatchApp(
  mails: SmbcNotificationMailBody[],
  overrides: Parameters<typeof createTestApp>[0] = {},
): Promise<ReturnType<typeof createTestApp>> {
  const t = createTestApp({
    gmailMailFetchGateway: {
      fetchMails: () => Promise.resolve({ ok: true, smbcMails: mails, amazonMails: [] }),
    },
    parseSmbcNotificationMail: ({ mail, userId }) =>
      SmbcMailParseResultSchema.parse({
        kind: 'card_usage',
        gmailMessageId: mail.gmailMessageId,
        userId,
        merchantName: 'スーパーA',
        amount: money(1200),
        occurredAt: MAIL_OCCURRED_AT,
        cardKind: 'mitsui_sumitomo',
      }),
    ...overrides,
  })
  await t.deps.gmailOAuthTokenRepository.save(
    GmailOAuthTokenSchema.parse({
      kind: 'valid',
      userId: VIEWER_ID,
      tokenStoreRef: '/warimaru/gmail/honey',
      authorizedAt: new Date('2026-07-01T00:00:00Z'),
      lastVerifiedAt: new Date('2026-07-01T00:00:00Z'),
    }),
  )
  return t
}

function csvFormData(content: string = CSV): FormData {
  const form = new FormData()
  form.append('file', new File([content], 'statement.csv', { type: 'text/csv' }))
  form.append('targetMonth', '2026-07')
  return form
}

async function uploadCsv(app: ReturnType<typeof createTestApp>['app']): Promise<string> {
  const res = await request(app, 'POST', '/api/imports/csv', { formData: csvFormData() })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { job: { common: { importJobId: string } } }
  return body.job.common.importJobId
}

describe('POST /api/imports/csv', () => {
  it('CSV を取込み、候補が生成される', async () => {
    const { app } = createTestApp()
    const importJobId = await uploadCsv(app)
    const res = await request(app, 'GET', `/api/imports/${importJobId}/candidates`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { jobKind: string; candidates: unknown[] }
    expect(body.jobKind).toBe('completed')
    expect(body.candidates).toHaveLength(2)
  })

  it('file フィールドなしは 400', async () => {
    const { app } = createTestApp()
    const form = new FormData()
    form.append('targetMonth', '2026-07')
    const res = await request(app, 'POST', '/api/imports/csv', { formData: form })
    expect(res.status).toBe(400)
  })

  it('1MB 超のファイルは 400', async () => {
    const { app } = createTestApp()
    const form = new FormData()
    form.append('file', new File([new Uint8Array(1_000_001)], 'big.csv', { type: 'text/csv' }))
    form.append('targetMonth', '2026-07')
    const res = await request(app, 'POST', '/api/imports/csv', { formData: form })
    expect(res.status).toBe(400)
  })

  it('不正な multipart ボディは 400（500 に落ちない、#565）', async () => {
    const { app } = createTestApp()
    const res = await app.request('/api/imports/csv', {
      method: 'POST',
      headers: {
        'X-User-Id': VIEWER_ID,
        'Content-Type': 'multipart/form-data; boundary=----garbageboundary',
      },
      body: 'not really multipart data at all',
    })
    expect(res.status).toBe(400)
  })

  it('フォーマット不正は 422 でジョブが format_validation_failed になる', async () => {
    const { app } = createTestApp()
    const res = await request(app, 'POST', '/api/imports/csv', {
      formData: csvFormData('2026/02/30,スーパーA,100\n'),
    })
    expect(res.status).toBe(422)
    const body = (await res.json()) as { job: { kind: string } }
    expect(body.job.kind).toBe('failed')
  })

  it('10件ごとに processedCount が途中保存される', async () => {
    const rows = Array.from(
      { length: 15 },
      (_, i) => `2026/07/${String(i + 1).padStart(2, '0')},店舗${i},${(i + 1) * 100}`,
    )
    const deps = createMockDeps({})
    const original = deps.statementImportJobRepository
    const saveCalls: { kind: string; processedCount: number | undefined }[] = []
    deps.statementImportJobRepository = {
      ...original,
      async save(job) {
        saveCalls.push({
          kind: job.kind,
          processedCount: job.kind === 'importing' ? job.processedCount : undefined,
        })
        return original.save(job)
      },
    }
    const app = createApp(deps)
    const res = await request(app, 'POST', '/api/imports/csv', {
      formData: csvFormData(rows.join('\n') + '\n'),
    })
    expect(res.status).toBe(201)
    const importingSaves = saveCalls.filter(c => c.kind === 'importing')
    expect(importingSaves.length).toBe(2)
    expect(importingSaves[0]!.processedCount).toBe(0)
    expect(importingSaves[1]!.processedCount).toBe(10)
    const completedSaves = saveCalls.filter(c => c.kind === 'completed')
    expect(completedSaves).toHaveLength(1)
  })

  it('候補保存の途中失敗でもジョブが failed(import_error) として記録される', async () => {
    const deps = createTestAppDepsWithFailingCandidateSave(2)
    const res = await request(deps.app, 'POST', '/api/imports/csv', { formData: csvFormData() })
    expect(res.status).toBe(500)
    const jobs = await deps.deps.statementImportJobRepository.findByUserAndMonth(
      VIEWER_ID,
      YearMonthSchema.parse('2026-07'),
    )
    expect(jobs).toHaveLength(1)
    const job = jobs[0]
    if (job?.kind !== 'failed') throw new Error(`failed を期待したが ${job?.kind}`)
    expect(job.failureReason.kind).toBe('import_error')
  })
})

/** N 回目の候補 save で失敗するようにラップしたテストアプリ */
function createTestAppDepsWithFailingCandidateSave(
  failAt: number,
): ReturnType<typeof createTestApp> {
  const deps = createMockDeps({})
  const original = deps.transactionCandidateRepository
  let saveCount = 0
  deps.transactionCandidateRepository = {
    ...original,
    async save(candidate) {
      saveCount++
      if (saveCount === failAt) throw new Error('injected save failure')
      return original.save(candidate)
    },
  }
  return { app: createApp(deps), deps }
}

function pdfFormData(
  bytes: Uint8Array<ArrayBuffer> = new Uint8Array([0x25, 0x50, 0x44, 0x46]),
): FormData {
  const form = new FormData()
  form.append('file', new File([bytes], 'statement.pdf', { type: 'application/pdf' }))
  form.append('targetMonth', '2026-06')
  return form
}

/** PDF→CSV 変換を固定結果のスタブに差し替えたテストアプリ */
function createPdfTestApp(conversion: PdfToCsvConversion): ReturnType<typeof createTestApp> {
  const deps = createMockDeps({})
  deps.pdfToCsvConverter = { convert: async () => conversion }
  return { app: createApp(deps), deps }
}

const PDF_ROWS: PdfToCsvConversion = {
  ok: true,
  rows: [
    {
      occurredAt: new Date(Date.UTC(2026, 5, 5)),
      merchantName: 'スーパーA',
      amount: 1200,
      pageNumber: 1,
    },
    {
      occurredAt: new Date(Date.UTC(2026, 5, 7)),
      merchantName: 'コーヒーショップ',
      amount: 300,
      pageNumber: 2,
    },
  ],
}

describe('POST /api/imports/pdf', () => {
  it('変換成功で候補が生成され、pdf 由来の importSource を持つ', async () => {
    const { app } = createPdfTestApp(PDF_ROWS)
    const res = await request(app, 'POST', '/api/imports/pdf', { formData: pdfFormData() })
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      job: { kind: string; common: { importJobId: string; fileFormat?: string } }
      pdfConversionJobId: string
    }
    expect(body.job.kind).toBe('completed')
    expect(body.pdfConversionJobId).toBeTruthy()

    const candidatesRes = await request(
      app,
      'GET',
      `/api/imports/${body.job.common.importJobId}/candidates`,
    )
    expect(candidatesRes.status).toBe(200)
    const candidatesBody = (await candidatesRes.json()) as {
      candidates: { common: { importSource: { kind: string; pdfConversionJobId?: string } } }[]
    }
    expect(candidatesBody.candidates).toHaveLength(2)
    for (const candidate of candidatesBody.candidates) {
      expect(candidate.common.importSource.kind).toBe('pdf')
      expect(candidate.common.importSource.pdfConversionJobId).toBe(body.pdfConversionJobId)
    }
  })

  it('確定で pdf 由来の候補から未分類取引が生成される', async () => {
    const { app, deps } = createPdfTestApp(PDF_ROWS)
    const res = await request(app, 'POST', '/api/imports/pdf', { formData: pdfFormData() })
    const body = (await res.json()) as { job: { common: { importJobId: string } } }
    const confirm = await request(app, 'PUT', `/api/imports/${body.job.common.importJobId}/confirm`)
    expect(confirm.status).toBe(200)
    const confirmBody = (await confirm.json()) as { confirmedCount: number }
    expect(confirmBody.confirmedCount).toBe(2)
    const transactions = await deps.transactionRepository.findByMonth(
      VIEWER_ID,
      YearMonthSchema.parse('2026-06'),
    )
    expect(transactions).toHaveLength(2)
  })

  it('再アップロードは三項一致で重複除外される', async () => {
    const { app } = createPdfTestApp(PDF_ROWS)
    await request(app, 'POST', '/api/imports/pdf', { formData: pdfFormData() })
    const second = await request(app, 'POST', '/api/imports/pdf', { formData: pdfFormData() })
    expect(second.status).toBe(201)
    const body = (await second.json()) as {
      job: { kind: string; summary: { newCount: number; duplicateExcludedCount: number } }
    }
    expect(body.job.summary.newCount).toBe(0)
    expect(body.job.summary.duplicateExcludedCount).toBe(2)
  })

  it('変換失敗は 422 でジョブが pdf_conversion_failed になる', async () => {
    const { app, deps } = createPdfTestApp({
      ok: false,
      reason: 'row_count_mismatch',
      failureDetail: '明細行数が一致しない（抽出 1 行 / 記載 2 行）',
    })
    const res = await request(app, 'POST', '/api/imports/pdf', { formData: pdfFormData() })
    expect(res.status).toBe(422)
    const body = (await res.json()) as {
      job: {
        kind: string
        failureReason?: { kind: string; reason: string; failureDetail: string }
      }
      conversionFailureReason: string
    }
    expect(body.job.kind).toBe('failed')
    expect(body.conversionFailureReason).toBe('row_count_mismatch')
    expect(body.job.failureReason?.kind).toBe('pdf_conversion_failed')
    // 失敗理由が failureDetail への埋め込みではなく構造化フィールドで保持される（#61）
    expect(body.job.failureReason?.reason).toBe('row_count_mismatch')
    expect(body.job.failureReason?.failureDetail).toBe(
      '明細行数が一致しない（抽出 1 行 / 記載 2 行）',
    )

    const jobs = await deps.statementImportJobRepository.findByUserAndMonth(
      VIEWER_ID,
      YearMonthSchema.parse('2026-06'),
    )
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.kind).toBe('failed')
  })

  it('file フィールドなしは 400', async () => {
    const { app } = createPdfTestApp(PDF_ROWS)
    const form = new FormData()
    form.append('targetMonth', '2026-06')
    const res = await request(app, 'POST', '/api/imports/pdf', { formData: form })
    expect(res.status).toBe(400)
  })

  it('%PDF シグネチャがないファイルは 400（ジョブは生成されない）', async () => {
    const { app, deps } = createPdfTestApp(PDF_ROWS)
    const res = await request(app, 'POST', '/api/imports/pdf', {
      formData: pdfFormData(new Uint8Array([0x00, 0x01, 0x02, 0x03])),
    })
    expect(res.status).toBe(400)
    // 同じ 400 でもサイズ超過（ZodError）と区別できるよう、機械可読な理由を返す（画面の文言選択に使う）
    const body = (await res.json()) as { error: string; reason?: string }
    expect(body.reason).toBe('not_a_pdf')
    const jobs = await deps.statementImportJobRepository.findByUserAndMonth(
      VIEWER_ID,
      YearMonthSchema.parse('2026-06'),
    )
    expect(jobs).toHaveLength(0)
  })

  it('10MB 超のファイルは 400（PDF 不正とは区別できる）', async () => {
    const { app } = createPdfTestApp(PDF_ROWS)
    const res = await request(app, 'POST', '/api/imports/pdf', {
      formData: pdfFormData(new Uint8Array(10_000_001)),
    })
    expect(res.status).toBe(400)
    // シグネチャ不一致ではないので not_a_pdf を返さない（画面が「PDF が壊れている」と誤案内しないため）
    const body = (await res.json()) as { reason?: string }
    expect(body.reason).toBeUndefined()
  })
})

describe('PUT /api/imports/:importJobId/confirm', () => {
  it('確定で未分類取引が生成され、再確定しても重複しない（冪等）', async () => {
    const { app, deps } = createTestApp()
    const importJobId = await uploadCsv(app)

    const first = await request(app, 'PUT', `/api/imports/${importJobId}/confirm`)
    expect(first.status).toBe(200)
    const firstBody = (await first.json()) as {
      confirmedCount: number
      alreadyConfirmedCount: number
    }
    expect(firstBody.confirmedCount).toBe(2)
    expect(firstBody.alreadyConfirmedCount).toBe(0)

    const second = await request(app, 'PUT', `/api/imports/${importJobId}/confirm`)
    expect(second.status).toBe(200)
    const secondBody = (await second.json()) as {
      confirmedCount: number
      alreadyConfirmedCount: number
    }
    expect(secondBody.confirmedCount).toBe(0)
    expect(secondBody.alreadyConfirmedCount).toBe(2)

    const transactions = await deps.transactionRepository.findByMonth(
      VIEWER_ID,
      YearMonthSchema.parse('2026-07'),
    )
    expect(transactions).toHaveLength(2)
  })

  it('取引 ID は候補 ULID を再利用する（決定的 ID）', async () => {
    const { app, deps } = createTestApp()
    const importJobId = await uploadCsv(app)
    const candidatesRes = await request(app, 'GET', `/api/imports/${importJobId}/candidates`)
    const { candidates } = (await candidatesRes.json()) as {
      candidates: { common: { transactionCandidateId: string } }[]
    }
    await request(app, 'PUT', `/api/imports/${importJobId}/confirm`)
    const transactions = await deps.transactionRepository.findByMonth(
      VIEWER_ID,
      YearMonthSchema.parse('2026-07'),
    )
    expect(transactions.map(t => t.common.transactionId).sort()).toEqual(
      candidates.map(candidate => candidate.common.transactionCandidateId).sort(),
    )
  })
})

describe('POST /api/imports/mail-batch', () => {
  it('from > to は 400', async () => {
    const { app } = createTestApp()
    const res = await request(app, 'POST', '/api/imports/mail-batch', {
      body: { from: '2026-07-10T00:00:00Z', to: '2026-07-09T00:00:00Z' },
    })
    expect(res.status).toBe(400)
  })

  it('from === to は 400（ドメイン不変条件 from < to と一致）', async () => {
    const { app } = createTestApp()
    const res = await request(app, 'POST', '/api/imports/mail-batch', {
      body: { from: '2026-07-10T00:00:00Z', to: '2026-07-10T00:00:00Z' },
    })
    expect(res.status).toBe(400)
  })

  it('Gmail 未連携なら 409 で返り、取込を起動しなかったことが結末に載る', async () => {
    // 成功と同じ 200 で返すと、呼んだ人が「取り込めた」と受け取ってしまう
    const { app, deps } = createTestApp()
    const res = await request(app, 'POST', '/api/imports/mail-batch', {
      body: { from: '2026-07-09T00:00:00Z', to: '2026-07-10T00:00:00Z' },
    })
    expect(res.status).toBe(409)
    const json = (await res.json()) as {
      batch: { kind: string } | null
      result: { status: string; reason?: string }
    }
    expect(json.result.status).toBe('not_launched')
    expect(json.result.reason).toBe('not_linked')
    // 起動していないのでバッチ記録は残らない（失敗記録が毎回積み上がらない）
    expect(json.batch).toBeNull()
    expect(await deps.dailyMailImportBatchRepository.findInProgressByUser(VIEWER_ID)).toBeNull()
  })

  it('Gmail 連携済みならメールを取り込んで完了する', async () => {
    const { app, deps } = await authorizedMailBatchApp([mailBody('gmail-route-1')])
    const res = await request(app, 'POST', '/api/imports/mail-batch', {
      body: { from: '2026-07-09T00:00:00Z', to: '2026-07-10T00:00:00Z' },
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      batch: { kind: string }
      result: { status: string; importedCount: number }
    }
    expect(json.result).toMatchObject({ status: 'completed', importedCount: 1 })
    expect(json.batch.kind).toBe('completed')
    const candidate = await deps.transactionCandidateRepository.findByGmailMessageId(
      VIEWER_ID,
      GmailMessageIdSchema.parse('gmail-route-1'),
    )
    expect(candidate?.common.merchantName).toBe('スーパーA')
  })

  it('取得に失敗したら 502 で返る（時間をおいて再実行すれば直りうる失敗）', async () => {
    const { app } = await authorizedMailBatchApp([], {
      gmailMailFetchGateway: {
        fetchMails: () =>
          Promise.resolve({
            ok: false,
            failure: {
              kind: 'other_fetch_failure',
              detail: 'Gmail API がタイムアウトした（list）',
              detectedAt: new Date('2026-07-10T00:00:00Z'),
              retryable: true,
            },
          }),
      },
    })
    const res = await request(app, 'POST', '/api/imports/mail-batch', {
      body: { from: '2026-07-09T00:00:00Z', to: '2026-07-10T00:00:00Z' },
    })
    expect(res.status).toBe(502)
  })

  it('取得中にトークン失効を検知したら 409 で返る（再認可が要る＝利用者の操作待ち）', async () => {
    // 502（時間をおいて再実行）と取り違えると、再認可すべき人に「あとで試す」と案内される
    const { app } = await authorizedMailBatchApp([], {
      gmailMailFetchGateway: {
        fetchMails: () =>
          Promise.resolve({
            ok: false,
            failure: {
              kind: 'oauth_revocation_detected',
              detail: 'Gmail API が認可を拒否した（401）',
              detectedAt: new Date('2026-07-10T00:00:00Z'),
            },
          }),
      },
    })
    const res = await request(app, 'POST', '/api/imports/mail-batch', {
      body: { from: '2026-07-09T00:00:00Z', to: '2026-07-10T00:00:00Z' },
    })
    expect(res.status).toBe(409)
    const json = (await res.json()) as {
      batch: { kind: string }
      result: { status: string; failureKind: string }
    }
    expect(json.result).toMatchObject({
      status: 'failed',
      failureKind: 'oauth_revocation_detected',
    })
    // 起動済みのバッチは失敗として閉じる（未連携で起動しなかった場合と違い記録は残る）
    expect(json.batch.kind).toBe('failed')
  })

  it('to だけ指定すると from は過去 5 日前に補われる', async () => {
    const { app } = await authorizedMailBatchApp([])
    const res = await request(app, 'POST', '/api/imports/mail-batch', {
      body: { to: '2026-07-10T00:00:00Z' },
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { result: { targetPeriod: { from: string; to: string } } }
    expect(json.result.targetPeriod.from).toBe('2026-07-05T00:00:00.000Z')
    expect(json.result.targetPeriod.to).toBe('2026-07-10T00:00:00.000Z')
  })

  it('from だけ指定するとその日時から現在までを取り込む', async () => {
    const { app } = await authorizedMailBatchApp([])
    const from = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    const res = await request(app, 'POST', '/api/imports/mail-batch', {
      body: { from: from.toISOString() },
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { result: { targetPeriod: { from: string; to: string } } }
    expect(json.result.targetPeriod.from).toBe(from.toISOString())
    expect(new Date(json.result.targetPeriod.to).getTime()).toBeGreaterThan(from.getTime())
  })

  it('取込対象期間が 31 日を超える指定は 400（Gmail の取得上限で必ず失敗するため）', async () => {
    const { app } = await authorizedMailBatchApp([])
    const res = await request(app, 'POST', '/api/imports/mail-batch', {
      body: { from: '2026-05-01T00:00:00Z', to: '2026-07-10T00:00:00Z' },
    })
    expect(res.status).toBe(400)
    const json = (await res.json()) as { reason?: string }
    expect(json.reason).toBe('period_too_long')
  })

  it('期間逆転ガードは進行中バッチの照会より先に効く（400 が再開に化けない）', async () => {
    // from < to は domain スキーマの parse（ワーカーの入口）が単一ソース。取込中のバッチが
    // 残っていても、期間逆転は「再開」ではなく 400 で弾かれる
    const { app, deps } = await authorizedMailBatchApp([])
    await deps.dailyMailImportBatchRepository.save(leftoverImportingBatch())
    const res = await request(app, 'POST', '/api/imports/mail-batch', {
      body: { from: '2026-07-10T00:00:00Z', to: '2026-07-09T00:00:00Z' },
    })
    expect(res.status).toBe(400)
  })

  it('クールダウンを過ぎた取込中バッチは新規起動せず引き継ぐ（引き継ぎを止めない）', async () => {
    const { app, deps } = await authorizedMailBatchApp([])
    await deps.dailyMailImportBatchRepository.save(leftoverImportingBatch())
    const res = await request(app, 'POST', '/api/imports/mail-batch', { body: {} })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { result: { resumed: boolean; importBatchId: string } }
    expect(json.result.resumed).toBe(true)
    expect(json.result.importBatchId).toBe('01BATCH0000000000000000000')
  })

  it('直前に取込が終わっていれば 429 で受け付けない（待ち時間つき）', async () => {
    let fetchCount = 0
    const { app, deps } = await authorizedMailBatchApp([], {
      gmailMailFetchGateway: {
        fetchMails: () => {
          fetchCount++
          return Promise.resolve({ ok: true, smbcMails: [], amazonMails: [] })
        },
      },
    })
    await deps.dailyMailImportBatchRepository.save(recentBatch('completed'))

    const res = await request(app, 'POST', '/api/imports/mail-batch', { body: {} })

    expect(res.status).toBe(429)
    const json = (await res.json()) as { reason?: string; retryAfterSeconds?: number }
    expect(json.reason).toBe('cooling_down')
    // 直前（0 秒前）に終わっているので、待ち時間はクールダウンいっぱいの 10 分
    expect(json.retryAfterSeconds).toBe(600)
    expect(res.headers.get('Retry-After')).toBe('600')
    // 弾いた実行は取込を始めない（Gmail を叩かない・新しいバッチ記録を作らない）
    expect(fetchCount).toBe(0)
    expect(await deps.dailyMailImportBatchRepository.findInProgressByUser(VIEWER_ID)).toBeNull()
    const latest = await deps.dailyMailImportBatchRepository.findLatestByUser(VIEWER_ID)
    expect(latest?.common.importBatchId).toBe('01BATCH0000000000000000001')
  })

  it('待ち時間は直前の実行からの経過ぶんだけ短くなる（切り上げ）', async () => {
    // 定数を返しっぱなしにしたり、切り上げを切り捨てにしたりすると案内が実際より短くなり、
    // 待ってから叩き直してもまた弾かれる
    const { app, deps } = await authorizedMailBatchApp([])
    await deps.dailyMailImportBatchRepository.save(
      recentBatch('completed', new Date(Date.now() - 90_000)),
    )
    const res = await request(app, 'POST', '/api/imports/mail-batch', { body: {} })
    expect(res.status).toBe(429)
    expect(((await res.json()) as { retryAfterSeconds: number }).retryAfterSeconds).toBe(510)

    const fresh = await authorizedMailBatchApp([])
    await fresh.deps.dailyMailImportBatchRepository.save(
      recentBatch('completed', new Date(Date.now() - 1_500)),
    )
    const res2 = await request(fresh.app, 'POST', '/api/imports/mail-batch', { body: {} })
    expect(((await res2.json()) as { retryAfterSeconds: number }).retryAfterSeconds).toBe(599)
  })

  it('取込が走っている最中に叩き直すと 429（引き継ぎで走っている実行でも同じ）', async () => {
    // 前の実行が残したバッチを引き継いだ実行は、引き継いだ時点から新たにクールダウンが効く。
    // 残存バッチの古い時刻のままだと、走っている最中の叩き直しを止められない
    const holder: { app?: ReturnType<typeof createTestApp>['app'] } = {}
    let duringRun: Response | undefined
    const t = await authorizedMailBatchApp([], {
      gmailMailFetchGateway: {
        fetchMails: async () => {
          duringRun = await request(holder.app!, 'POST', '/api/imports/mail-batch', { body: {} })
          return { ok: true, smbcMails: [], amazonMails: [] }
        },
      },
    })
    holder.app = t.app
    await t.deps.dailyMailImportBatchRepository.save(leftoverImportingBatch())

    const first = await request(t.app, 'POST', '/api/imports/mail-batch', { body: {} })

    expect(first.status).toBe(200)
    expect(((await first.json()) as { result: { resumed: boolean } }).result.resumed).toBe(true)
    expect(duringRun?.status).toBe(429)
  })

  it('実行中に重ねて叩いても、進行中バッチを引き継がず 429（同じ記録の二重書き換えを防ぐ）', async () => {
    // 応答を待てずに叩き直したときが本命。引き継ぎ経路に 2 つの実行が乗ると、同じバッチ記録を
    // 両方が書き換える
    const { app, deps } = await authorizedMailBatchApp([mailBody('gmail-cooldown-1')])
    const inProgress = recentBatch('importing')
    await deps.dailyMailImportBatchRepository.save(inProgress)

    const res = await request(app, 'POST', '/api/imports/mail-batch', { body: {} })

    expect(res.status).toBe(429)
    // 進行中バッチは触られないまま残る（完了にも失敗にも倒れない）
    expect(await deps.dailyMailImportBatchRepository.findInProgressByUser(VIEWER_ID)).toEqual(
      inProgress,
    )
    // 取込も走っていない
    expect(
      await deps.transactionCandidateRepository.findByGmailMessageId(
        VIEWER_ID,
        GmailMessageIdSchema.parse('gmail-cooldown-1'),
      ),
    ).toBeNull()
  })

  it('不正な JSON ボディは 400（500 に落ちない）', async () => {
    const { app } = createTestApp()
    const res = await app.request('/api/imports/mail-batch', {
      method: 'POST',
      headers: { 'X-User-Id': VIEWER_ID, 'Content-Type': 'application/json' },
      body: '{ not json',
    })
    expect(res.status).toBe(400)
  })
})
