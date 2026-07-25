import { test, expect } from '@playwright/test'

const API_URL = 'http://localhost:3001'
const HEADERS = {
  'Content-Type': 'application/json',
  'X-User-Id': 'U_DARLING_DEV',
}
const CAT_OTHER = '01JAAAAAAAAAAAAAAAAAAAAAA4'
const EXPENSE_TYPE_GYM = '01JEEEEEEEEEEEEEEEEEEEEE1'
const CURRENT_MONTH = new Date().toISOString().slice(0, 7)

test.describe('AT-202: 未分類取引の3軸修正と学習ルール即時登録', () => {
  let firstTxId: string
  let secondTxId: string

  test('手順1+2: 未分類取引を作成し3軸で分類', async ({ request }) => {
    const createRes = await request.post(`${API_URL}/api/transactions`, {
      headers: HEADERS,
      data: {
        merchantName: 'TEST-アニタイム',
        amount: 7000,
        occurredAt: new Date().toISOString(),
      },
    })
    expect(createRes.status()).toBe(201)
    const created = await createRes.json()
    firstTxId = created.common.transactionId
    expect(created.kind).toBe('unclassified')

    const classifyRes = await request.put(`${API_URL}/api/transactions/${firstTxId}/classify`, {
      headers: HEADERS,
      data: {
        categoryId: CAT_OTHER,
        expenseClass: 'business_expense',
        expenseTypeId: EXPENSE_TYPE_GYM,
      },
    })
    expect(classifyRes.status()).toBe(200)
    const classified = await classifyRes.json()
    expect(classified.kind).toBe('classified')
    expect(classified.details.categoryId).toBe(CAT_OTHER)
    expect(classified.details.expenseClass).toBe('business_expense')
    expect(classified.details.expenseTypeRef.kind).toBe('business')
    expect(classified.details.expenseTypeRef.expenseTypeId).toBe(EXPENSE_TYPE_GYM)
  })

  test('手順3: 学習ルールが即時登録されている', async ({ request }) => {
    const res = await request.get(`${API_URL}/api/classification/merchant-rules`, {
      headers: HEADERS,
    })
    expect(res.status()).toBe(200)
    const { items } = await res.json()
    const rule = items.find(
      (r: { common: { merchantName: string } }) => r.common.merchantName === 'TEST-アニタイム',
    )
    expect(rule).toBeTruthy()
    expect(rule.kind).toBe('active')
    expect(rule.categoryRef.kind).toBe('learned')
    expect(rule.categoryRef.categoryId).toBe(CAT_OTHER)
    expect(rule.expenseClassRef.kind).toBe('learned')
    expect(rule.expenseClassRef.expenseClass).toBe('business_expense')
    expect(rule.expenseTypeRef.kind).toBe('learned')
    expect(rule.expenseTypeRef.expenseTypeId).toBe(EXPENSE_TYPE_GYM)
  })

  test('手順4: 学習ルールを使って同じ加盟店の新規取引を分類済みで登録', async ({ request }) => {
    const rulesRes = await request.get(`${API_URL}/api/classification/merchant-rules`, {
      headers: HEADERS,
    })
    const { items } = await rulesRes.json()
    const rule = items.find(
      (r: { common: { merchantName: string } }) => r.common.merchantName === 'TEST-アニタイム',
    )
    expect(rule).toBeTruthy()

    const createRes = await request.post(`${API_URL}/api/transactions`, {
      headers: HEADERS,
      data: {
        merchantName: 'TEST-アニタイム',
        amount: 8000,
        occurredAt: new Date().toISOString(),
        classification: {
          categoryId: rule.categoryRef.categoryId,
          expenseClass: rule.expenseClassRef.expenseClass,
          expenseTypeId: rule.expenseTypeRef.expenseTypeId,
        },
      },
    })
    expect(createRes.status()).toBe(201)
    const created = await createRes.json()
    secondTxId = created.common.transactionId
    expect(created.kind).toBe('classified')
    expect(created.details.categoryId).toBe(CAT_OTHER)
    expect(created.details.expenseClass).toBe('business_expense')
  })

  test.afterAll(async ({ request }) => {
    for (const id of [firstTxId, secondTxId]) {
      if (id) {
        await request.delete(`${API_URL}/api/transactions/${id}`, { headers: HEADERS })
      }
    }
    await request.post(`${API_URL}/api/classification/merchant-rules/disable`, {
      headers: HEADERS,
      data: { merchantName: 'TEST-アニタイム' },
    })
  })
})
