import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * 実際に描画された操作部品が、タップターゲットの下限(`docs/design/usability.md` §4-3)を
 * 満たしているかを実寸で確かめる(#568)。
 *
 * CSS の宣言そのものは `src/test/tap-target.test.ts` が押さえているが、宣言があっても
 * 画面側のクラスが後から高さを潰せば実寸は下限を割る。VRT のピクセル差は「変わったこと」
 * しか教えず、しかも画面全体に対する差が許容比(1%)に収まると素通りするため、下限を
 * 満たすかどうかはここで数値として固定する。
 *
 * 対象は共通の操作部品(`components/ui/common.module.css` の 5 クラスと、それを
 * 使うボタン風リンク)と、共通部品であるモーダルの閉じるボタン・2 択の切り替え
 * (`components/ui/SegmentedControl.tsx`)。画面ごとに独自の
 * スタイルを持つボタン(設定のタブ・月送り・下部ナビなど)は #467 の対象。
 */

/** 下限の値は `globals.css` の `--tap-target-min` が正。ここに数値を書き写さない */
async function tapTargetMin(page: Page): Promise<number> {
  const declared = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--tap-target-min'),
  )
  const px = Number.parseFloat(declared)
  expect(px, '--tap-target-min が px で定義されている').toBeGreaterThan(0)
  return px
}

/** 44×44 は縦横どちらの規定でもあるため、高さと幅の両方を測る */
async function expectTapTargetSize(locator: Locator, name: string, min: number): Promise<void> {
  await expect(locator, `${name} が表示されている`).toBeVisible()
  const box = await locator.boundingBox()
  expect(box, `${name} の位置と大きさを取得できる`).not.toBeNull()
  expect(box?.height ?? 0, `${name} の高さ`).toBeGreaterThanOrEqual(min)
  expect(box?.width ?? 0, `${name} の幅`).toBeGreaterThanOrEqual(min)
}

test('取込画面のボタンと選択欄が下限の大きさを満たす', async ({ page }) => {
  await page.goto('/imports')
  const min = await tapTargetMin(page)

  await expectTapTargetSize(
    page.getByRole('button', { name: /ファイルを選択して取込/ }),
    '取込ボタン',
    min,
  )
  // ファイル種別の切り替え(SegmentedControl)。ラジオは透明にして選択肢いっぱいに広げており、
  // 押せる範囲が見た目の枠と一致していることをここで実寸として固定する
  const fileKind = page.getByRole('radiogroup', { name: 'ファイル種別' })
  for (const label of ['カード利用明細', '銀行入出金明細']) {
    await expectTapTargetSize(
      fileKind.getByRole('radio', { name: label }),
      `ファイル種別の切り替え（${label}）`,
      min,
    )
  }
})

test('共通ボタンを使う他の画面でも下限の大きさを満たす', async ({ page }) => {
  await page.goto('/settings')
  const min = await tapTargetMin(page)

  await expectTapTargetSize(page.getByRole('button', { name: '保存' }), '設定の保存ボタン', min)
  // ニックネームの入力欄。`<label>` が入力に関連付いていない(usability §9 の既知の未対応)ため、
  // 未入力時のプレースホルダで指す
  await expectTapTargetSize(
    page.getByPlaceholder('未設定（ロール名で表示）'),
    '設定の入力欄（ニックネーム）',
    min,
  )
})

test('ボタンの見た目のリンクが下限の大きさを満たす', async ({ page }) => {
  // `<a>` は既定が inline で min-height が効かないため、`.buttonLink` の display 指定が
  // 下限の成立条件になっている。宣言だけでは崩れに気づけないのでここで実寸を測る
  await page.goto('/onboarding')
  const min = await tapTargetMin(page)

  await expectTapTargetSize(
    page.getByRole('link', { name: 'ダッシュボードへ' }),
    'オンボーディングのダッシュボードへのリンク',
    min,
  )
})

test('モーダルの操作部品が下限の大きさを満たす', async ({ page }) => {
  await page.goto('/transactions')
  const min = await tapTargetMin(page)

  await page.getByRole('button', { name: '未分類をまとめて分類する' }).click()
  const dialog = page.getByRole('dialog', { name: 'まとめて分類' })

  await expectTapTargetSize(
    dialog.getByRole('button', { name: 'まとめて分類をやめる' }),
    'まとめて分類をやめるボタン',
    min,
  )
  // 中身がアイコンだけのボタン。文字が無いぶん幅が足りなくなりやすい(§4-3)
  await expectTapTargetSize(dialog.getByRole('button', { name: '閉じる' }), '閉じるボタン', min)
})
