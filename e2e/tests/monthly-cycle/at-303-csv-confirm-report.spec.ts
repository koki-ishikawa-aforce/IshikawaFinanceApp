import { test, expect } from '@playwright/test'
import { E2E_HONEY_USER_ID, E2E_DARLING_USER_ID } from '../../global-setup'

const API_URL = 'http://localhost:3001'
const HEADERS = { 'X-User-Id': E2E_HONEY_USER_ID }
const DARLING_HEADERS = { 'X-User-Id': E2E_DARLING_USER_ID }

const TARGET_MONTH = '2099-03'

function csvForConfirm(): string {
  return [
    '日付,店名,金額',
    '2099/03/01,TEST-確定スーパー,3000',
    '2099/03/15,TEST-確定ドラッグ,1500',
  ].join('\n')
}

test.describe('AT-303: CSV 確定とレポート状態昇格', () => {
  test.describe.configure({ mode: 'serial' })

  let cycleId: string

  test('AT-303 準備: CSV 取込・確定・取引生成', async ({ request }) => {
    const uploadRes = await request.post(`${API_URL}/api/imports/csv`, {
      headers: HEADERS,
      multipart: {
        file: { name: 'confirm.csv', mimeType: 'text/csv', buffer: Buffer.from(csvForConfirm()) },
        targetMonth: TARGET_MONTH,
      },
    })
    expect(uploadRes.status()).toBe(201)
    const { job } = await uploadRes.json()

    const confirmRes = await request.put(
      `${API_URL}/api/imports/${job.common.importJobId}/confirm`,
      { headers: HEADERS, data: {} },
    )
    expect(confirmRes.status()).toBe(200)
  })

  test('AT-303-1: 精算サイクルを作成し集積中状態であることを確認する', async ({ request }) => {
    const res = await request.post(`${API_URL}/api/expense-settlement/cycles`, {
      headers: HEADERS,
      data: { targetMonth: TARGET_MONTH },
    })
    expect(res.status()).toBe(201)

    const body = await res.json()
    expect(body.kind).toBe('accumulating')
    cycleId = body.common.monthlyExpenseCycleId
  })

  test('AT-303-2: CSV 確定操作でサイクルが csv_confirmed に昇格する', async ({ request }) => {
    const res = await request.put(
      `${API_URL}/api/expense-settlement/cycles/${cycleId}/confirm-csv`,
      { headers: HEADERS },
    )
    expect(res.status()).toBe(200)

    const body = await res.json()
    expect(body.kind).toBe('csv_confirmed')
  })

  test('AT-303-3: 月次レポートが取得でき、残高の枠を備えている', async ({ request }) => {
    // 404 を skip で読み飛ばさない（#398）。読み飛ばすと「レポートが生成されていない」
    // という回帰がそのまま緑で通り抜ける
    const res = await request.get(`${API_URL}/api/monthly-reports?month=${TARGET_MONTH}`, {
      headers: HEADERS,
    })

    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('csv_confirmed')
    expect(body.common.targetYearMonth).toBe(TARGET_MONTH)
    // 残高部分は残高変動履歴からの凍結値（#398）。この月は残高が動いていないため
    // 4 軸とも空になるが、枠そのものが欠けていないことを確かめる
    expect(body.common.balanceTrend).toMatchObject({
      smbcBalanceTrend: [],
      otherSavingsBalanceTrend: [],
      nisaContributionTrend: [],
      cardUnpaidTrend: [],
    })
    expect(typeof body.common.nisaContributionAccumulated).toBe('number')
  })

  test('AT-303-4: 未分類取引が残っていてもサイクル確定は成立している', async ({ request }) => {
    const summaryRes = await request.get(
      `${API_URL}/api/transactions/unclassified-summary?month=${TARGET_MONTH}`,
      { headers: HEADERS },
    )
    expect(summaryRes.status()).toBe(200)
    const summary = await summaryRes.json()
    expect(summary.count).toBeGreaterThanOrEqual(0)

    const cycleRes = await request.get(
      `${API_URL}/api/expense-settlement/cycles?month=${TARGET_MONTH}`,
      { headers: HEADERS },
    )
    expect(cycleRes.status()).toBe(200)
    const cycleBody = await cycleRes.json()
    expect(cycleBody.cycle).toBeDefined()
    expect(cycleBody.cycle.kind).toBe('csv_confirmed')
  })

  test('AT-303 プライバシー: darling は honey の精算サイクルを操作できない', async ({
    request,
  }) => {
    const res = await request.put(
      `${API_URL}/api/expense-settlement/cycles/${cycleId}/confirm-csv`,
      { headers: DARLING_HEADERS },
    )
    expect([403, 500]).toContain(res.status())
  })

  test('AT-303 プライバシー: darling は honey の取引明細を取得できない', async ({ request }) => {
    const res = await request.get(`${API_URL}/api/transactions?month=${TARGET_MONTH}`, {
      headers: DARLING_HEADERS,
    })
    expect(res.status()).toBe(200)
    const items = await res.json()
    const honeyItems = (Array.isArray(items) ? items : []).filter(
      (t: { merchantName: string | null }) => t.merchantName?.startsWith('TEST-'),
    )
    expect(honeyItems).toHaveLength(0)
  })
})
