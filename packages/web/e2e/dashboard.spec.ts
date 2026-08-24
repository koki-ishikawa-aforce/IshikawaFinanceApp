import { expect, test } from '@playwright/test'

/**
 * モック起動モード（NEXT_PUBLIC_MOCK=1、webServer 側で設定）のスモークテスト。
 * LIFF 認証・実 API なしでダッシュボードが描画され、ナビが表示されることを確認する。
 */
test('ダッシュボードが描画され、ナビが表示される', async ({ page }) => {
  await page.goto('/')

  // KPI（モック fixture 由来）が描画される
  await expect(page.getByText('今月支出')).toBeVisible()
  await expect(page.getByText('資産合計')).toBeVisible()

  // カテゴリ内訳はカードと見出しの内側にある（見出しの有無は VRT のベースライン更新では守れない）
  await expect(page.getByText('世帯支出（カテゴリ別）')).toBeVisible()

  // 下部ナビゲーションが表示される
  await expect(page.getByRole('navigation')).toBeVisible()
  await expect(page.getByRole('link', { name: 'ホーム' })).toBeVisible()

  // 既定ロールは darling テーマ
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'darling')
})

/**
 * 撮影中の「今」が固定されていること(#506)。
 *
 * これを確かめないと、固定日時の受け渡し(playwright.config.ts → next.config.ts の env →
 * ブラウザ / SSR)がどこかで切れても誰も気づけない。切れたときに起きるのは「月ラベルが
 * 実時刻に戻る」だけで、そのずれは maxDiffPixelRatio の許容量に吸収されて基準画像の
 * 比較は緑のまま通る — この PR が無くしたはずの失敗そのものに静かに戻る。
 *
 * 期待値は設定から導かず、リテラルで書く。導くと設定を書き換えたとき期待値も一緒に
 * 動いてしまい、固定が外れたことを検知できない。
 */
test('撮影中の「今」が 2026 年 7 月に固定されている', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByText('2026年7月')).toBeVisible()
})

test('?mockRole=honey で honey テーマに切り替わる', async ({ page }) => {
  await page.goto('/?mockRole=honey')

  await expect(page.getByText('今月支出')).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'honey')
})
