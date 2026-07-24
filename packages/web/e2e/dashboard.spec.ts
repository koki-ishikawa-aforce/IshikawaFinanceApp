import { expect, test } from '@playwright/test'

/**
 * モック起動モード（NEXT_PUBLIC_MOCK=1、webServer 側で設定）のスモークテスト。
 * LIFF 認証・実 API なしでダッシュボードが描画され、ナビが表示されることを確認する。
 */
test('ダッシュボードが描画され、ナビが表示される', async ({ page }) => {
  await page.goto('/')

  // KPI（モック fixture 由来）が描画される
  await expect(page.getByText('今月支出')).toBeVisible()
  await expect(page.getByText('総資産')).toBeVisible()

  // 下部ナビゲーションが表示される
  await expect(page.getByRole('navigation')).toBeVisible()
  await expect(page.getByRole('link', { name: 'ホーム' })).toBeVisible()

  // 既定ロールは darling テーマ
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'darling')
})

test('?mockRole=honey で honey テーマに切り替わる', async ({ page }) => {
  await page.goto('/?mockRole=honey')

  await expect(page.getByText('今月支出')).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'honey')
})
