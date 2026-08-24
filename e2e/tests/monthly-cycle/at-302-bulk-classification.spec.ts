import { test, expect } from '@playwright/test'
import { E2E_HONEY_USER_ID } from '../../global-setup'

const API_URL = 'http://localhost:3001'
const HEADERS = { 'X-User-Id': E2E_HONEY_USER_ID }

const TARGET_MONTH = '2099-02'

function csvForBulk(): string {
  return [
    '日付,店名,金額',
    '2099/02/01,TEST-薬局ウエルシア,2000',
    '2099/02/10,TEST-家電ヤマダ,5000',
  ].join('\n')
}

test.describe('AT-302: 取込サマリと一括分類セッション', () => {
  test.describe.configure({ mode: 'serial' })

  let transactionIds: string[] = []
  let bulkSessionId: string
  let categoryId: string
  let importJobId: string

  test('AT-302 準備: CSV 取込と確定', async ({ request }) => {
    const uploadRes = await request.post(`${API_URL}/api/imports/csv`, {
      headers: HEADERS,
      multipart: {
        file: { name: 'bulk.csv', mimeType: 'text/csv', buffer: Buffer.from(csvForBulk()) },
        targetMonth: TARGET_MONTH,
      },
    })
    expect(uploadRes.status()).toBe(201)
    const uploadBody = await uploadRes.json()
    importJobId = uploadBody.job.common.importJobId

    const confirmRes = await request.put(`${API_URL}/api/imports/${importJobId}/confirm`, {
      headers: HEADERS,
      data: {},
    })
    expect(confirmRes.status()).toBe(200)
  })

  test('AT-302-1: 取込完了のサマリに未分類件数が含まれる', async ({ request }) => {
    const res = await request.get(
      `${API_URL}/api/transactions/unclassified-summary?month=${TARGET_MONTH}`,
      { headers: HEADERS },
    )
    expect(res.status()).toBe(200)

    const body = await res.json()
    expect(body.count).toBeGreaterThanOrEqual(2)
  })

  test('AT-302 準備: カテゴリ作成と未分類取引 ID 取得', async ({ request }) => {
    const catRes = await request.post(`${API_URL}/api/categories`, {
      headers: HEADERS,
      data: { name: 'TEST-日用品カテゴリ' },
    })
    expect(catRes.status()).toBe(201)
    const catBody = await catRes.json()
    categoryId = catBody.categoryId

    const txRes = await request.get(`${API_URL}/api/transactions?month=${TARGET_MONTH}`, {
      headers: HEADERS,
    })
    expect(txRes.status()).toBe(200)
    const items = await txRes.json()
    transactionIds = (Array.isArray(items) ? items : [])
      .filter(
        (t: { isUnclassified: boolean; merchantName: string | null }) =>
          t.isUnclassified && t.merchantName?.startsWith('TEST-'),
      )
      .map((t: { transactionId: string }) => t.transactionId)
    expect(transactionIds.length).toBeGreaterThanOrEqual(2)
  })

  test('AT-302-2: 一括分類セッションを開始できる', async ({ request }) => {
    const res = await request.post(`${API_URL}/api/classification/bulk-sessions`, {
      headers: HEADERS,
      data: {
        trigger: { kind: 'csv_import', importJobId },
        transactionIds,
      },
    })
    expect(res.status()).toBe(201)

    const body = await res.json()
    expect(body.kind).toBe('in_progress')
    expect(body.common.targets).toHaveLength(transactionIds.length)
    bulkSessionId = body.common.bulkClassificationSessionId
  })

  test('AT-302-3: 取引を分類して一括保存する', async ({ request }) => {
    for (const txId of transactionIds) {
      const res = await request.put(`${API_URL}/api/transactions/${txId}/classify`, {
        headers: HEADERS,
        data: {
          categoryId,
          expenseClass: 'household',
        },
      })
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.kind).toBe('classified')
    }
  })

  test('AT-302-3b: 途中まで分類して離脱すると、続きに残るのは未分類のぶんだけ', async ({
    request,
  }) => {
    const firstId = transactionIds[0] as string
    const progressRes = await request.post(
      `${API_URL}/api/classification/bulk-sessions/${bulkSessionId}/progress`,
      { headers: HEADERS, data: { transactionIds: [firstId] } },
    )
    expect(progressRes.status()).toBe(200)

    const body = await progressRes.json()
    expect(body.kind).toBe('in_progress')
    expect(body.classifiedTransactionIds).toEqual([firstId])
    expect(body.remainingCount).toBe(transactionIds.length - 1)

    // 離脱して取引一覧に戻った状態（進捗はサーバーに残っている）
    const currentRes = await request.get(`${API_URL}/api/classification/bulk-sessions/current`, {
      headers: HEADERS,
    })
    expect(currentRes.status()).toBe(200)
    const { session } = await currentRes.json()
    expect(session.common.bulkClassificationSessionId).toBe(bulkSessionId)
    expect(session.classifiedTransactionIds).toEqual([firstId])
    expect(session.remainingCount).toBe(transactionIds.length - 1)
  })

  test('AT-302-4: セッションを完了できる', async ({ request }) => {
    const res = await request.post(
      `${API_URL}/api/classification/bulk-sessions/${bulkSessionId}/complete`,
      { headers: HEADERS },
    )
    expect(res.status()).toBe(200)

    const body = await res.json()
    expect(body.kind).toBe('completed')
    expect(body.processedCount).toBe(transactionIds.length)
  })

  test('AT-302-5: 別セッションの中断が動作する', async ({ request }) => {
    const extraCsv = ['日付,店名,金額', '2099/02/20,TEST-中断テスト店,999'].join('\n')
    const uploadRes = await request.post(`${API_URL}/api/imports/csv`, {
      headers: HEADERS,
      multipart: {
        file: { name: 'abort.csv', mimeType: 'text/csv', buffer: Buffer.from(extraCsv) },
        targetMonth: TARGET_MONTH,
      },
    })
    expect(uploadRes.status()).toBe(201)
    const { job } = await uploadRes.json()

    const confirmRes = await request.put(
      `${API_URL}/api/imports/${job.common.importJobId}/confirm`,
      {
        headers: HEADERS,
        data: {},
      },
    )
    expect(confirmRes.status()).toBe(200)

    const txRes = await request.get(`${API_URL}/api/transactions?month=${TARGET_MONTH}`, {
      headers: HEADERS,
    })
    const items = await txRes.json()
    const abortTxIds = (Array.isArray(items) ? items : [])
      .filter(
        (t: { isUnclassified: boolean; merchantName: string | null }) =>
          t.isUnclassified && t.merchantName === 'TEST-中断テスト店',
      )
      .map((t: { transactionId: string }) => t.transactionId)
    expect(abortTxIds.length).toBeGreaterThanOrEqual(1)

    const sessionRes = await request.post(`${API_URL}/api/classification/bulk-sessions`, {
      headers: HEADERS,
      data: {
        trigger: { kind: 'csv_import', importJobId: job.common.importJobId },
        transactionIds: abortTxIds,
      },
    })
    expect(sessionRes.status()).toBe(201)
    const session = await sessionRes.json()

    const abortRes = await request.post(
      `${API_URL}/api/classification/bulk-sessions/${session.common.bulkClassificationSessionId}/abort`,
      { headers: HEADERS },
    )
    expect(abortRes.status()).toBe(200)
    const abortBody = await abortRes.json()
    expect(abortBody.kind).toBe('aborted')
  })
})
