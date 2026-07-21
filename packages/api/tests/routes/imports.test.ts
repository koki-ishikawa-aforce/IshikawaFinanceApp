import { describe, it, expect } from 'vitest'
import { YearMonthSchema } from '@warimaru/domain'
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

describe('PUT /api/imports/:batchId/confirm', () => {
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
})
