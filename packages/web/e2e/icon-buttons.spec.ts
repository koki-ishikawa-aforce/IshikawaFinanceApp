import { expect, test } from '@playwright/test'

/**
 * 記号文字をアイコンに置き換えたボタン(#344)の読み上げ名を固定する。
 *
 * アイコン化でボタンから可視テキストが消えるため、読み上げ名は `aria-label` だけが
 * 担う。ラベルを落としても VRT のピクセル差は出ないので、ここで押さえていないと
 * 「名前の無いボタン」になったまま検査が緑で通る。
 */
test('月送りボタンは読み上げ名を持ち、記号文字を表示しない', async ({ page }) => {
  await page.goto('/')

  const prev = page.getByRole('button', { name: '前月' })
  const next = page.getByRole('button', { name: '次月' })
  await expect(prev).toBeVisible()
  await expect(next).toBeVisible()
  await expect(prev).toHaveText('')
  await expect(next).toHaveText('')

  // 押すと月表示が実際に切り替わる（アイコン化で操作が壊れていないこと）
  const monthLabel = page.getByText(/^\d{4}年\d{1,2}月$/)
  const before = await monthLabel.innerText()
  await prev.click()
  await expect(monthLabel).not.toHaveText(before)
})

test('取引追加ボタンは読み上げ名を持ち、記号文字を表示しない', async ({ page }) => {
  await page.goto('/transactions')

  const fab = page.getByRole('button', { name: '取引を追加' })
  await expect(fab).toBeVisible()
  await expect(fab).toHaveText('')

  await expect(page.locator('body')).not.toContainText('＋')
})
