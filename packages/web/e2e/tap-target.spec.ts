import { expect, test, type Locator } from '@playwright/test'

/**
 * 実際に描画された操作部品が、タップターゲットの下限(`docs/design/usability.md` §4-3)を
 * 満たしているかを実寸で確かめる(#568)。
 *
 * CSS の宣言そのものは `src/test/tap-target.test.ts` が押さえているが、宣言があっても
 * 画面側のクラスが後から高さを潰せば実寸は下限を割る。VRT のピクセル差は「変わったこと」
 * しか教えないため、下限を満たすかどうかはここで数値として固定する。
 */

/** docs/design/usability.md §4-3。globals.css の `--tap-target-min` と同じ値 */
const TAP_TARGET_MIN = 44

async function expectTapTargetHeight(locator: Locator, name: string): Promise<void> {
  await expect(locator, `${name} が表示されている`).toBeVisible()
  const box = await locator.boundingBox()
  expect(box, `${name} の位置と大きさを取得できる`).not.toBeNull()
  expect(box?.height ?? 0, `${name} の高さ`).toBeGreaterThanOrEqual(TAP_TARGET_MIN)
}

test('取込画面のボタンと選択欄が下限の高さを満たす', async ({ page }) => {
  await page.goto('/imports')

  await expectTapTargetHeight(
    page.getByRole('button', { name: /ファイルを選択して取込/ }),
    '取込ボタン',
  )
  await expectTapTargetHeight(page.getByLabel('ファイル種別'), 'ファイル種別の選択欄')
})

test('共通ボタンを使う他の画面でも下限の高さを満たす', async ({ page }) => {
  await page.goto('/settings')

  await expectTapTargetHeight(page.getByRole('button', { name: '保存' }), '設定の保存ボタン')
  // ニックネームの入力欄。`<label>` が入力に関連付いていない(usability §9 の既知の未対応)ため、
  // 未入力時のプレースホルダで指す
  await expectTapTargetHeight(
    page.getByPlaceholder('未設定（ロール名で表示）'),
    '設定の入力欄（ニックネーム）',
  )
})
