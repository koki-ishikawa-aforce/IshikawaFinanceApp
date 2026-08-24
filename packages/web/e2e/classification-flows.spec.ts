import { expect, test } from '@playwright/test'
import { hideDevOverlay, waitForAppFonts, waitForDataLoaded } from './fonts'
import { mockRoleQuery } from './screens'

/**
 * 一括分類セッションと遡及一括再分類（#402）のビジュアルリグレッション。
 *
 * どちらも操作して初めて開くため、画面単位の VRT（visual-regression.spec.ts）では
 * 写らない。モック起動モードの固定データ上で導線をたどり、開いた状態を撮る。
 */

/** モック fixture の未分類加盟店数（darling は配偶者に見えない Amazon の 1 件を多く持つ） */
const MERCHANT_COUNT = { darling: 3, honey: 2 } as const

for (const theme of ['darling', 'honey'] as const) {
  test(`bulk classification - ${theme} theme`, async ({ page }) => {
    const response = await page.goto(`/transactions${mockRoleQuery(theme)}`)

    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await page.getByRole('button', { name: '未分類をまとめて分類する' }).click()

    const dialog = page.getByRole('dialog', { name: 'まとめて分類' })
    await expect(
      dialog.getByText(`1 / ${MERCHANT_COUNT[theme]} 店舗（分類済み 0 件）`),
    ).toBeVisible()
    await page.waitForLoadState('networkidle')
    await waitForDataLoaded(page, response)
    await waitForAppFonts(page)
    await hideDevOverlay(page)

    await expect(page).toHaveScreenshot(`bulk-classification-${theme}.png`, { fullPage: true })
  })

  test(`retroactive reclassification - ${theme} theme`, async ({ page }) => {
    const response = await page.goto(`/transactions${mockRoleQuery(theme)}`)

    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await page.getByRole('button', { name: /ドラッグストアA/ }).click()

    const detail = page.getByRole('dialog', { name: '未分類取引' })
    await detail.getByLabel('カテゴリ').selectOption({ label: '食費' })
    await detail.getByRole('button', { name: '分類を確定' }).click()

    const dialog = page.getByRole('dialog', { name: '過去の取引にも適用' })
    await expect(
      dialog.getByText(/過去にも未分類の「ドラッグストアA」の取引が 2 件あります/),
    ).toBeVisible()
    await page.waitForLoadState('networkidle')
    await waitForDataLoaded(page, response)
    await waitForAppFonts(page)
    await hideDevOverlay(page)

    await expect(page).toHaveScreenshot(`retroactive-${theme}.png`, { fullPage: true })
  })
}
