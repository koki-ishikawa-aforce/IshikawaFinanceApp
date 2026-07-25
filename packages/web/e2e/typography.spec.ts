import { expect, test } from '@playwright/test'

/**
 * フォーム要素のフォント継承（#310）。
 *
 * button / input / select / textarea は UA スタイルシートが font ショートハンドを持つため、
 * 明示的に継承させないと html / body の --font-family（Zen Maru Gothic）が効かず、
 * 既定書体（Chromium では Arial）で描画される。CJK 既定フォントを持たない環境では
 * 日本語ラベルが豆腐（□□）になるため、computed style で継承を検証する。
 */

/** ダッシュボードは世帯/個人トグルと月ナビゲーションの button を含む */
const SCREENS = [
  { name: 'dashboard', path: '/' },
  { name: 'transactions', path: '/transactions' },
  { name: 'settings', path: '/settings' },
] as const

for (const screen of SCREENS) {
  test(`${screen.name}: すべての button が body と同じフォントを継承する`, async ({ page }) => {
    await page.goto(screen.path)
    await page.waitForLoadState('networkidle')

    const bodyFontFamily = await page.evaluate(() => getComputedStyle(document.body).fontFamily)
    expect(bodyFontFamily).toContain('Zen Maru Gothic')

    const buttonFontFamilies = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button')).map(el => getComputedStyle(el).fontFamily),
    )
    expect(buttonFontFamilies.length).toBeGreaterThan(0)
    for (const fontFamily of buttonFontFamilies) {
      expect(fontFamily).toBe(bodyFontFamily)
    }
  })
}

test('ダッシュボードの世帯/個人トグルが設計書体で描画される', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const toggle = page.getByRole('button', { name: '世帯' })
  await expect(toggle).toBeVisible()

  // Arial 等の UA 既定書体に落ちていないこと（CJK フォントを持たない環境での豆腐化を防ぐ）
  await expect(toggle).toHaveCSS('font-family', /Zen Maru Gothic/)
})

test('入力系フォーム要素も body と同じフォントを継承する', async ({ page }) => {
  await page.goto('/transactions')
  await page.waitForLoadState('networkidle')

  const inheritedElsewhere = await page.evaluate(() => {
    const bodyFontFamily = getComputedStyle(document.body).fontFamily
    const elements = Array.from(document.querySelectorAll('input, select, textarea'))
    return {
      count: elements.length,
      allInherit: elements.every(el => getComputedStyle(el).fontFamily === bodyFontFamily),
    }
  })

  expect(inheritedElsewhere.count).toBeGreaterThan(0)
  expect(inheritedElsewhere.allInherit).toBe(true)
})
