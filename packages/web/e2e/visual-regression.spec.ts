import { expect, test } from '@playwright/test'
import { hideDevOverlay, waitForAppFonts } from './fonts'
import { SCREENS, screenUrl } from './screens'

for (const screen of SCREENS) {
  for (const theme of ['darling', 'honey'] as const) {
    test(`${screen.name} - ${theme} theme`, async ({ page }) => {
      await page.goto(screenUrl(screen.path, theme))

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
