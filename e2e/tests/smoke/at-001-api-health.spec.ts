import { test, expect } from '@playwright/test'

const API_URL = 'http://localhost:3001'

test('AT-001: API ヘルスチェック', async ({ request }) => {
  const res = await request.get(`${API_URL}/health`)
  expect(res.status()).toBe(200)

  const body = await res.json()
  expect(body).toHaveProperty('ok', true)
})
