import { test, expect } from '@playwright/test'
import { E2E_HONEY_USER_ID } from '../../global-setup'

const API_URL = 'http://localhost:3001'
const HEADERS = { 'X-User-Id': E2E_HONEY_USER_ID }

const TARGET_MONTH = '2099-01'

function validCsv(): string {
  return [
    '日付,店名,金額',
    '2099/01/05,TEST-スーパーマルエツ,1500',
    '2099/01/10,TEST-ドラッグストア,800',
    '2099/01/15,TEST-コンビニ,350',
  ].join('\n')
}

test.describe('AT-301: カード CSV 取込（検証・候補確認・重複除外）', () => {
  test.describe.configure({ mode: 'serial' })

  let importJobId: string

  test('AT-301-1: CSV アップロードでジョブが完了する', async ({ request }) => {
    const res = await request.post(`${API_URL}/api/imports/csv`, {
      headers: HEADERS,
      multipart: {
        file: { name: 'card.csv', mimeType: 'text/csv', buffer: Buffer.from(validCsv()) },
        targetMonth: TARGET_MONTH,
      },
    })
    expect(res.status()).toBe(201)

    const body = await res.json()
    expect(body.job).toBeDefined()
    expect(body.job.kind).toBe('completed')
    importJobId = body.job.common.importJobId
  })

  test('AT-301-2: 候補一覧に CSV の取引が表示される', async ({ request }) => {
    const res = await request.get(`${API_URL}/api/imports/${importJobId}/candidates`, {
      headers: HEADERS,
    })
    expect(res.status()).toBe(200)

    const body = await res.json()
    expect(body.candidates).toHaveLength(3)
    const names = body.candidates.map(
      (c: { common: { merchantName: string } }) => c.common.merchantName,
    )
    expect(names).toContain('TEST-スーパーマルエツ')
    expect(names).toContain('TEST-ドラッグストア')
    expect(names).toContain('TEST-コンビニ')
  })

  test('AT-301-3: 候補から 1 件を除外して取込確定する', async ({ request }) => {
    const candidatesRes = await request.get(`${API_URL}/api/imports/${importJobId}/candidates`, {
      headers: HEADERS,
    })
    const { candidates } = await candidatesRes.json()
    const idsToConfirm = candidates
      .filter(
        (c: { common: { merchantName: string } }) => c.common.merchantName !== 'TEST-コンビニ',
      )
      .map((c: { common: { transactionCandidateId: string } }) => c.common.transactionCandidateId)
    expect(idsToConfirm).toHaveLength(2)

    const res = await request.put(`${API_URL}/api/imports/${importJobId}/confirm`, {
      headers: HEADERS,
      data: { transactionCandidateIds: idsToConfirm },
    })
    expect(res.status()).toBe(200)

    const body = await res.json()
    expect(body.confirmedCount).toBe(2)
  })

  test('AT-301-4: 取引一覧に取込済みの取引が表示される', async ({ request }) => {
    const res = await request.get(`${API_URL}/api/transactions?month=${TARGET_MONTH}`, {
      headers: HEADERS,
    })
    expect(res.status()).toBe(200)

    const body = await res.json()
    const items = body.items ?? body
    const testItems = (Array.isArray(items) ? items : []).filter(
      (t: { common: { merchantName: string } }) => t.common.merchantName.startsWith('TEST-'),
    )
    expect(testItems.length).toBeGreaterThanOrEqual(2)
  })

  test('AT-301-5: 同じ CSV を再アップロードすると重複が除外される', async ({ request }) => {
    const res = await request.post(`${API_URL}/api/imports/csv`, {
      headers: HEADERS,
      multipart: {
        file: { name: 'card.csv', mimeType: 'text/csv', buffer: Buffer.from(validCsv()) },
        targetMonth: TARGET_MONTH,
      },
    })
    expect(res.status()).toBe(201)

    const body = await res.json()
    expect(body.job.kind).toBe('completed')
    expect(body.job.result.duplicateExcludedCount).toBeGreaterThanOrEqual(2)
  })

  test('AT-301-6: 不正な形式のファイルをアップロードすると検証エラーになる', async ({
    request,
  }) => {
    const invalidContent = 'これはCSVではないテキストファイルです'
    const res = await request.post(`${API_URL}/api/imports/csv`, {
      headers: HEADERS,
      multipart: {
        file: { name: 'invalid.csv', mimeType: 'text/csv', buffer: Buffer.from(invalidContent) },
        targetMonth: TARGET_MONTH,
      },
    })
    expect(res.status()).toBe(422)

    const body = await res.json()
    expect(body.job.kind).toBe('failed')
  })
})
