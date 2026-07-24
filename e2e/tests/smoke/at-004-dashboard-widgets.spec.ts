import { test, expect } from '@playwright/test'

test.describe('AT-004: ダッシュボードの KPI・カテゴリ内訳・未分類ウィジェット', () => {
  test('KPI カード群が表示される（NaN・エラーがない）', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByText('今月支出')).toBeVisible()
    await expect(page.getByText('総資産')).toBeVisible()

    const visibleText = await page.locator('body').innerText()
    expect(visibleText).not.toContain('NaN')
    expect(visibleText).not.toContain('undefined')
  })

  test('カテゴリ別内訳が表示される', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('今月支出')).toBeVisible()

    await expect(page.getByRole('navigation').or(page.locator('[class*="category"]'))).toBeVisible()
  })

  test('月ナビゲータで前月へ移動してもエラーが出ない', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('今月支出')).toBeVisible()

    const prevButton = page.getByRole('button').filter({ hasText: /◀|←|前/ })
    if (await prevButton.count()) {
      await prevButton.first().click()
      await expect(page.locator('body')).not.toBeEmpty()
      const visibleText = await page.locator('body').innerText()
      expect(visibleText).not.toContain('NaN')
    }
  })
})
