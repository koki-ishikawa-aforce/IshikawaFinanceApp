import { expect, test } from '@playwright/test'

/**
 * 画面内で実際に使う書体・ウェイトを明示的にロードしてから撮影する。
 *
 * `document.fonts.ready`（Playwright の待機に含まれる）は「現時点で要求済みのフォント」の
 * 解決を待つだけで、Zen Maru Gothic のようにサブセット分割された Web フォントは
 * 使われるまでロードされない。フォーム要素がフォントを継承するようになった（#310）ことで
 * ボタンの行ボックス高が Zen Maru Gothic のメトリクスに依存するようになり、
 * ロード完了前に撮影すると 2px ずれた状態が写ってスナップショットが不安定になる。
 */
async function waitForAppFonts(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(async () => {
    const family = '"Zen Maru Gothic"'
    await Promise.all(
      ['400', '500', '700'].flatMap(weight =>
        ['12px', '13.3333px', '14px', '20px'].map(size =>
          document.fonts.load(`${weight} ${size} ${family}`),
        ),
      ),
    )
    await document.fonts.ready
  })
}

/**
 * Next.js の開発オーバーレイ（左下のインジケーター）は状態が実行ごとに変わり
 * （折りたたみ / "N Issues" の展開）、スナップショット比較のノイズになるため隠す。
 */
async function hideDevOverlay(page: import('@playwright/test').Page): Promise<void> {
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
}

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
      await waitForAppFonts(page)
      await hideDevOverlay(page)

      await expect(page).toHaveScreenshot(`${screen.name}-${theme}.png`, {
        fullPage: true,
      })
    })
  }
}
