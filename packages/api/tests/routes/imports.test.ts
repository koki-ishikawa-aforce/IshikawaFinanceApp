import { describe, it, expect } from 'vitest'
import { YearMonthSchema, type PdfToCsvConversion } from '@warimaru/domain'
import { createApp } from '../../src/app.js'
import { createDeps } from '../../src/composition-root.js'
import { createTestApp, request, VIEWER_ID } from '../helpers/test-app.js'

const CSV = '2026/07/05,スーパーA,1200\n2026/07/06,コンビニB,300\n'

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

  it('フォーマット不正は 422 でジョブが format_validation_failed になる', async () => {
    const { app } = createTestApp()
    const res = await request(app, 'POST', '/api/imports/csv', {
      formData: csvFormData('2026/02/30,スーパーA,100\n'),
    })
    expect(res.status).toBe(422)
    const body = (await res.json()) as { job: { kind: string } }
    expect(body.job.kind).toBe('failed')
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
  const deps = createDeps({})
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
  const deps = createDeps({})
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
    const jobs = await deps.statementImportJobRepository.findByUserAndMonth(
      VIEWER_ID,
      YearMonthSchema.parse('2026-06'),
    )
    expect(jobs).toHaveLength(0)
  })

  it('10MB 超のファイルは 400', async () => {
    const { app } = createPdfTestApp(PDF_ROWS)
    const res = await request(app, 'POST', '/api/imports/pdf', {
      formData: pdfFormData(new Uint8Array(10_000_001)),
    })
    expect(res.status).toBe(400)
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
