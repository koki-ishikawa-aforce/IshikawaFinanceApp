import { expect, test } from '@playwright/test'
import { DESIGN_FONT_FAMILY, waitForAppFonts } from './fonts'
import { SCREENS, mockRoleQuery } from './screens'

/**
 * フォーム要素のフォント継承（#310）。
 *
 * button / input / select / textarea は UA スタイルシートが font ショートハンドを持つため、
 * 明示的に継承させないと html / body の --font-family（Zen Maru Gothic）が効かず、
 * 既定書体（Chromium では Arial）で描画される。CJK 既定フォントを持たない環境では
 * 日本語ラベルが豆腐（□□）になるため、computed style と実グリフの両方を検証する。
 */

const FORM_SELECTOR = 'button, input, select, textarea'

for (const screen of SCREENS) {
  test(`${screen.name}: フォーム要素が body と同じフォントを継承する`, async ({ page }) => {
    await page.goto(screen.path)
    await page.waitForLoadState('networkidle')

    const result = await page.evaluate(selector => {
      const bodyFontFamily = getComputedStyle(document.body).fontFamily
      const elements = Array.from(document.querySelectorAll(selector))
      return {
        bodyFontFamily,
        count: elements.length,
        // 継承していない要素を「どれか」が分かる形で返す（失敗時にレポートへ出す）
        offenders: elements
          .filter(el => getComputedStyle(el).fontFamily !== bodyFontFamily)
          .map(el => `${el.tagName.toLowerCase()}.${el.className || '(no class)'}`),
      }
    }, FORM_SELECTOR)

    expect(result.bodyFontFamily).toContain(DESIGN_FONT_FAMILY)
    expect(result.offenders).toEqual([])
    // モック fixture が無い画面はフォーム要素を描画しないため、件数は画面ごとに 0 でもよい。
    // 検証が全画面で空振りしていないことは下のダッシュボードのテストが担保する。
  })
}

test('ダッシュボードの世帯/個人トグルが設計書体の日本語グリフで描画される', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await waitForAppFonts(page)

  // 検証対象のフォーム要素が実在することをここで担保する（画面ごとのテストが空振りしないため）
  const formControls = await page.locator(FORM_SELECTOR).count()
  expect(formControls).toBeGreaterThan(0)

  // 2 択の切り替えは SegmentedControl（透明なラジオ + 見た目を担うラベル）。書体が効くのは
  // 見た目を担うラベルの側なので、そちらを測る
  const toggle = page
    .getByRole('radiogroup', { name: '集計の範囲' })
    .getByText('世帯', { exact: true })
  await expect(toggle).toBeVisible()
  await expect(toggle).toHaveCSS('font-family', new RegExp(DESIGN_FONT_FAMILY))

  // 書体名の一致だけでは豆腐化を防げない（サブセット未ロードでも名前は一致する）ため、
  // 実際に描画されるラベルのグリフが設計書体で利用可能かを確認する
  const hasJapaneseGlyphs = await page.evaluate(
    family => document.fonts.check(`700 14px "${family}"`, '世帯個人'),
    DESIGN_FONT_FAMILY,
  )
  expect(hasJapaneseGlyphs).toBe(true)
})

test('honey テーマでもフォーム要素のフォント継承が保たれる', async ({ page }) => {
  await page.goto(`/${mockRoleQuery('honey')}`)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'honey')
  await page.waitForLoadState('networkidle')

  const offenders = await page.evaluate(selector => {
    const bodyFontFamily = getComputedStyle(document.body).fontFamily
    return Array.from(document.querySelectorAll(selector))
      .filter(el => getComputedStyle(el).fontFamily !== bodyFontFamily)
      .map(el => el.tagName.toLowerCase())
  }, FORM_SELECTOR)

  expect(offenders).toEqual([])
})
