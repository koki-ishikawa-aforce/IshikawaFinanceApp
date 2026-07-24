import { test, expect } from '@playwright/test'

const ROUTES = [
  { path: '/', name: 'ダッシュボード' },
  { path: '/transactions', name: '取引一覧' },
  { path: '/balances', name: '残高一覧' },
  { path: '/reports', name: '月次レポート' },
  { path: '/expense-settlement', name: '精算サイクル' },
  { path: '/imports', name: '取込' },
  { path: '/settings', name: '設定' },
  { path: '/onboarding', name: 'オンボーディング' },
] as const

for (const { path, name } of ROUTES) {
  test(`AT-005: ${name} (${path}) がエラーなく表示される`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', err => errors.push(err.message))

    const res = await page.goto(path)
    expect(res?.status()).toBeLessThan(400)

    await expect(page.locator('body')).not.toBeEmpty()

    expect(errors).toEqual([])
  })
}
