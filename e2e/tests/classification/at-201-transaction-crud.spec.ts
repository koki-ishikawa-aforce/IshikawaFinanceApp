import { test, expect } from '@playwright/test'
import { E2E_DARLING_USER_ID } from '../../global-setup'

const API_URL = 'http://localhost:3001'
const HEADERS = {
  'Content-Type': 'application/json',
  'X-User-Id': E2E_DARLING_USER_ID,
}
const CURRENT_MONTH = new Date().toISOString().slice(0, 7)

test.describe.serial('AT-201: 取引の手動登録・編集・削除', () => {
  let transactionId: string

  test('手順1: TEST-コーナン ¥1500 を登録', async ({ request }) => {
    const res = await request.post(`${API_URL}/api/transactions`, {
      headers: HEADERS,
      data: {
        merchantName: 'TEST-コーナン',
        amount: 1500,
        occurredAt: new Date().toISOString(),
      },
    })
    expect(res.status()).toBe(201)

    const body = await res.json()
    expect(body.common.merchantName).toBe('TEST-コーナン')
    expect(body.common.amount).toBe(1500)
    transactionId = body.common.transactionId
    expect(transactionId).toBeTruthy()
  })

  test('手順2: 登録直後の分類状態が未分類', async ({ request }) => {
    expect(transactionId).toBeTruthy()

    const list = await request.get(`${API_URL}/api/transactions?month=${CURRENT_MONTH}`, {
      headers: HEADERS,
    })
    expect(list.status()).toBe(200)

    // 一覧 Query はプライバシー3段階適用済みのフラットな行を配列で返す（集約そのものではない）
    const items = await list.json()
    expect(Array.isArray(items)).toBe(true)
    const tx = items.find((t: { transactionId: string }) => t.transactionId === transactionId)
    expect(tx).toBeTruthy()
    expect(tx.isUnclassified).toBe(true)
    expect(tx.expenseClass).toBe('personal_darling')
  })

  test('手順3: 未分類件数に反映', async ({ request }) => {
    const res = await request.get(
      `${API_URL}/api/transactions/unclassified-summary?month=${CURRENT_MONTH}`,
      { headers: HEADERS },
    )
    expect(res.status()).toBe(200)

    const body = await res.json()
    expect(body.count).toBeGreaterThanOrEqual(1)
    expect(body.recentIds).toContain(transactionId)
  })

  test('手順4: 金額を ¥1600 に編集', async ({ request }) => {
    expect(transactionId).toBeTruthy()

    const res = await request.put(`${API_URL}/api/transactions/${transactionId}`, {
      headers: HEADERS,
      data: { amount: 1600 },
    })
    expect(res.status()).toBe(200)

    const body = await res.json()
    expect(body.common.amount).toBe(1600)
  })

  test('手順5: 取引を削除', async ({ request }) => {
    expect(transactionId).toBeTruthy()

    const res = await request.delete(`${API_URL}/api/transactions/${transactionId}`, {
      headers: HEADERS,
    })
    expect(res.status()).toBe(200)

    const body = await res.json()
    expect(body.kind).toBe('deleted')

    const summary = await request.get(
      `${API_URL}/api/transactions/unclassified-summary?month=${CURRENT_MONTH}`,
      { headers: HEADERS },
    )
    const summaryBody = await summary.json()
    expect(summaryBody.recentIds).not.toContain(transactionId)
  })
})
