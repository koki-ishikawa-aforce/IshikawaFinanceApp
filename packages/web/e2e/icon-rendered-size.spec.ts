import { expect, test, type Locator } from '@playwright/test'

/**
 * 同じ役目のアイコンが、画面をまたいで実際に同じ大きさ（px）で描画されているかを実測する。
 *
 * アイコンの大きさは小・中・大の3段階のトークン（`--icon-sm` / `--icon-md` / `--icon-lg`）から
 * 選ぶ決まりで、どのトークンを使っているかは `src/test/icon-size-scale.test.ts` が固定している。
 * ただしトークンは `em` 単位のため、実際に描画される px は「アイコンの基準となる font-size ×
 * トークンの係数」で決まり、**同じトークンを選んでも基準の font-size が画面ごとに違えば実寸は
 * そろわない**（DESIGN.md「大きさ」）。#502 ではまさにこの取り違えが起き、段階だけを合わせた
 * 結果かえって実寸の差が広がっていたが、レビューで指摘されるまで自動テストでは検出できなかった。
 *
 * ここではタップターゲット下限の実測（`tap-target.spec.ts`）と同じ二段構えの考え方で、
 * 実際にブラウザで描画させ、同じ役目のアイコンの実寸(px)が一致することを固定する（#633）。
 */

async function iconRenderedSize(
  icon: Locator,
  name: string,
): Promise<{ width: number; height: number }> {
  await expect(icon, `${name} が表示されている`).toBeVisible()
  const box = await icon.boundingBox()
  expect(box, `${name} の大きさを取得できる`).not.toBeNull()
  return { width: box?.width ?? 0, height: box?.height ?? 0 }
}

/** サブピクセルの丸め差はそろっているとみなす。取り違えは 1px 未満では収まらない差になる */
function expectSameRenderedSize(
  actual: { width: number; height: number },
  expected: { width: number; height: number },
  name: string,
): void {
  expect(Math.round(actual.width), `${name} の幅`).toBe(Math.round(expected.width))
  expect(Math.round(actual.height), `${name} の高さ`).toBe(Math.round(expected.height))
}

test('追加ボタンのプラスアイコンが画面をまたいで同じ実寸で描画される（#502）', async ({ page }) => {
  // 設定 > 口座の「〜を追加」ボタン。既定シナリオは全種別登録済みで追加ボタンが出ないため、
  // 未登録の種別が残るシナリオを使う（screens.ts の settings-accounts-unregistered と同じ）
  await page.goto('/settings?section=accounts&mockScenario=accounts-unregistered')
  const accountsAddIcon = page.getByRole('button', { name: '別銀行貯蓄口座を追加' }).locator('svg')
  const accountsSize = await iconRenderedSize(
    accountsAddIcon,
    '設定「別銀行貯蓄口座を追加」ボタンのアイコン',
  )

  await page.goto('/expense-settlement')
  const depositAddIcon = page.getByRole('button', { name: '入金記録を追加' }).locator('svg')
  const depositSize = await iconRenderedSize(
    depositAddIcon,
    '精算「入金記録を追加」ボタンのアイコン',
  )

  expectSameRenderedSize(depositSize, accountsSize, '精算の追加アイコン')
})

test('残高一覧の口座種別アイコンと相手の役割アイコンが同じ実寸で描画される（#502）', async ({
  page,
}) => {
  await page.goto('/balances')

  // 口座ごとの行は「口座を追加」導線と違い、押せることを示すリンクとして描画される
  const smbcIcon = page
    .getByRole('link', { name: /三井住友銀行/ })
    .locator('svg')
    .first()
  const smbcSize = await iconRenderedSize(smbcIcon, '残高一覧「三井住友銀行」のアイコン')

  // 相手の合計行は押せないため <div> のまま(押せる行と見た目で区別する意図。page.tsx 参照)
  const spouseIcon = page
    .locator('div')
    .filter({ hasText: /の貯蓄・NISA（合計のみ）/ })
    .locator('svg')
    .first()
  const spouseSize = await iconRenderedSize(spouseIcon, '残高一覧の相手ロールアイコン')
  expectSameRenderedSize(spouseSize, smbcSize, '相手ロールアイコン')

  // 残る口座種別のアイコンもすべて同じ実寸であること
  for (const [pattern, label] of [
    [/三井住友カード/, '三井住友カード'],
    [/楽天銀行/, '楽天銀行'],
    [/SBI証券/, 'SBI証券 NISA'],
  ] as const) {
    const icon = page.getByRole('link', { name: pattern }).locator('svg').first()
    const size = await iconRenderedSize(icon, `残高一覧「${label}」のアイコン`)
    expectSameRenderedSize(size, smbcSize, `「${label}」のアイコン`)
  }
})
