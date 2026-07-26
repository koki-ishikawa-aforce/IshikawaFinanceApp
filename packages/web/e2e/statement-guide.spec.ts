import { expect, test } from '@playwright/test'

/**
 * 明細 CSV の取得手順ガイド(#404)の開閉を、実ブラウザの CSS が効いた状態で押さえる。
 *
 * 折りたたみは `hidden` 属性で行うが、`hidden` の `display: none` は UA スタイル由来で
 * オーサースタイルの `display: flex` に負ける。jsdom の単体テストは CSS Modules を
 * 適用しないため `hidden` 属性だけを見て緑になり、この破綻を検出できない。
 */
test('取得手順は畳まれて始まり、押すと開いて、もう一度押すと閉じる', async ({ page }) => {
  await page.goto('/imports')

  const toggle = page.getByRole('button', { name: /三井住友カード.*取得方法/ })
  const step = page.getByText('「ご利用明細データダウンロード」から CSV を保存する')

  await expect(toggle).toBeVisible()
  await expect(step).toBeHidden()

  await toggle.click()
  await expect(step).toBeVisible()

  await toggle.click()
  await expect(step).toBeHidden()
})

test('カードと銀行の 2 枚は独立して開閉する', async ({ page }) => {
  await page.goto('/imports')

  const cardStep = page.getByText('「ご利用明細データダウンロード」から CSV を保存する')
  const bankStep = page.getByText('SMBC ダイレクトにログインする')

  await page.getByRole('button', { name: /三井住友カード.*取得方法/ }).click()

  await expect(cardStep).toBeVisible()
  await expect(bankStep).toBeHidden()
})
