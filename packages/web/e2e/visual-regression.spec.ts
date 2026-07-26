import { expect, test } from '@playwright/test'
import { hideDevOverlay, waitForAppFonts } from './fonts'
import { SCREENS, screenUrl } from './screens'

for (const screen of SCREENS) {
  for (const theme of ['darling', 'honey'] as const) {
    test(`${screen.name} - ${theme} theme`, async ({ page }) => {
      await page.goto(screenUrl(screen.path, theme))

      // パスが持つクエリ(設定のタブ指定など)がテーマ指定との連結で壊れていないことを確かめる。
      // 落ちていても既定タブの画面が同じ名前で撮れてしまい、基準画像の差分には現れないため。
      for (const [key, value] of new URLSearchParams(screen.path.split('?')[1] ?? '')) {
        await expect(page).toHaveURL(new RegExp(`[?&]${key}=${value}(&|$)`))
      }
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await page.waitForLoadState('networkidle')
      await waitForAppFonts(page)
      await hideDevOverlay(page)

      await expect(page).toHaveScreenshot(`${screen.name}-${theme}.png`, {
        fullPage: true,
      })
    })
  }
}
