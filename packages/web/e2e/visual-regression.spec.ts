import { expect, test } from '@playwright/test'

const SCREENS = [
  { name: 'dashboard', path: '/' },
  { name: 'transactions', path: '/transactions' },
  { name: 'balances', path: '/balances' },
  { name: 'reports', path: '/reports' },
  { name: 'settings', path: '/settings' },
  { name: 'onboarding', path: '/onboarding' },
] as const

for (const screen of SCREENS) {
  for (const theme of ['darling', 'honey'] as const) {
    test(`${screen.name} - ${theme} theme`, async ({ page }) => {
      const mockRole = theme === 'honey' ? '?mockRole=honey' : ''
      await page.goto(`${screen.path}${mockRole}`)

      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await page.waitForLoadState('networkidle')

      await expect(page).toHaveScreenshot(`${screen.name}-${theme}.png`, {
        fullPage: true,
      })
    })
  }
}
