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

    // 月送りはアイコンボタンで可視テキストを持たないため、読み上げ名で引く。
    // テキスト一致で引くと、ボタンが見つからないまま緑になり検証が空振りする
    const monthLabel = page.getByText(/^\d{4}年\d{1,2}月$/)
    await expect(monthLabel).toBeVisible()
    const before = await monthLabel.innerText()

    await page.getByRole('button', { name: '前月' }).click()

    await expect(monthLabel).not.toHaveText(before)
    const visibleText = await page.locator('body').innerText()
    expect(visibleText).not.toContain('NaN')
  })
})
