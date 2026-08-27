import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * 下限が意味を持つのは片手で持つ縦画面(LIFF は 360〜390px 幅)。既定の 1280px 幅では
 * 下部ナビの項目がラベルの幅まで広がるなど、下限が効いているかを確かめられない。
 * VRT 側の幅を変えると基準画像を全部撮り直すことになるため、この spec だけ狭くする。
 */
test.use({ viewport: { width: 390, height: 844 } })

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
 * (`components/ui/SegmentedControl.tsx`。世帯/個人の切り替えは #366、資産推移の
 * 期間切り替え・取込の「閉じる」・オンボーディングの「スキップ」は #612 でこちらに
 * 寄せた)。これに加えて、画面固有のスタイルを持つ部品(ダッシュボードの月送り・
 * カテゴリ行は #366、下部ナビ・設定のタブ・精算の小ボタン・チェック行は #467)も測る。
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

  // 一覧の行に並ぶ文字だけのボタン(`.textButton`)。2 文字ぶんの幅しか無く、行の
  // レイアウト次第で実寸が縮むため、共通部品へ寄せた(#462)あとの大きさをここで測る
  await page.goto('/settings?section=categories')
  for (const label of [/を改名$/, /を削除$/]) {
    await expectTapTargetSize(
      page.getByRole('button', { name: label }).first(),
      `カテゴリ行の${label.source}`,
      min,
    )
  }
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

test('ダッシュボードの月送り・切り替え・カテゴリ行が下限の大きさを満たす', async ({ page }) => {
  // 共通部品を使わない画面固有の操作部品。CSS の宣言は src/test/tap-target.test.ts が
  // 押さえているが、月送りは中身がアイコンだけ・カテゴリ行は 1 行ぶんの文字しか無く、
  // 親のレイアウト次第で実寸が縮みうるためここで測る(#366)
  await page.goto('/')
  const min = await tapTargetMin(page)

  for (const name of ['前月', '次月']) {
    await expectTapTargetSize(page.getByRole('button', { name }), `月送り（${name}）`, min)
  }
  // 世帯/個人の切り替えは共通部品（SegmentedControl）に寄せたので、押せる受け皿はラジオ
  const mode = page.getByRole('radiogroup', { name: '集計の範囲' })
  for (const name of ['世帯', '個人']) {
    await expectTapTargetSize(
      mode.getByRole('radio', { name, exact: true }),
      `世帯/個人の切り替え（${name}）`,
      min,
    )
  }
  // 凡例は取引一覧へのドリルダウンを兼ねるリンク。押せる範囲が行と一致していることを測る
  await expectTapTargetSize(
    page.getByRole('link', { name: /食費/ }).first(),
    'カテゴリ内訳の凡例（食費）',
    min,
  )

  // 並んだ的の間隔(§4-4)。行を 44px に広げたぶん、負のマージンや gap の詰めで
  // 隣の行と密着すると誤タップにつながる。行の実寸の隙間として測る
  const first = await page
    .getByRole('link', { name: /住居費/ })
    .first()
    .boundingBox()
  const second = await page.getByRole('link', { name: /食費/ }).first().boundingBox()
  expect(first, '凡例の 1 行目の大きさを取得できる').not.toBeNull()
  expect(second, '凡例の 2 行目の大きさを取得できる').not.toBeNull()
  const gap = (second?.y ?? 0) - ((first?.y ?? 0) + (first?.height ?? 0))
  // 下限は --space-2(8px)。トークンの値をここに書き写さないよう、CSS から読む
  const minGap = await page.evaluate(() =>
    Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--space-2')),
  )
  expect(minGap, '--space-2 が px で定義されている').toBeGreaterThan(0)
  expect(gap, '凡例の行どうしの隙間').toBeGreaterThanOrEqual(minGap)
})

test('相手の個人費の吹き出しの閉じるボタンが下限の大きさを満たす', async ({ page }) => {
  // 吹き出し(SpousePersonalNote の .hint)自体は注意書きの薄い見た目のまま保ち、閉じる
  // ボタンだけを絶対配置で下限まで広げている(#611)。宣言だけでは意図どおりの実寸に
  // なっているか分からないため、右クリックでヒントを開いて実測する
  await page.goto('/')
  const min = await tapTargetMin(page)

  await page.getByRole('note').click({ button: 'right' })
  await expectTapTargetSize(
    page.getByRole('button', { name: '閉じる' }),
    '相手の個人費の吹き出しの閉じるボタン',
    min,
  )
})

test('下部ナビの項目が下限の大きさを満たす', async ({ page }) => {
  // 全画面に出る操作部品で、5 項目が横幅を取り合う。1 項目でも下限を割ると隣の画面へ
  // 飛ぶ誤タップになるため、実寸を全項目ぶん測る(#467。精算・取込は #614 で除外)
  await page.goto('/')
  const min = await tapTargetMin(page)

  const nav = page.getByRole('navigation')
  for (const label of ['ホーム', '取引', 'レポート', '残高', '設定']) {
    await expectTapTargetSize(nav.getByRole('link', { name: label }), `下部ナビ（${label}）`, min)
  }
})

test('設定のタブと他画面への入り口リンクが下限の大きさを満たす', async ({ page }) => {
  await page.goto('/settings')
  const min = await tapTargetMin(page)

  for (const label of ['プロフィール', '口座', 'カテゴリ', '経費種別', '月次上限', '学習']) {
    await expectTapTargetSize(
      page.getByRole('button', { name: label, exact: true }),
      `設定のタブ（${label}）`,
      min,
    )
  }
  // `<a>` は既定が inline で下限が効かない。表示形式の指定が崩れると実寸だけが縮む
  for (const [pattern, name] of [
    [/経費精算/, '経費精算を開くリンク'],
    [/取込画面/, '取込画面を開くリンク'],
    [/オンボーディング/, 'オンボーディングを開くリンク'],
  ] as const) {
    await expectTapTargetSize(page.getByRole('link', { name: pattern }), name, min)
  }
})

test('残高の期間切り替えと精算の小ボタンが下限の大きさを満たす', async ({ page }) => {
  await page.goto('/balances')
  const min = await tapTargetMin(page)

  // 資産推移の期間切り替えは共通部品(SegmentedControl)に寄せたので、押せる受け皿はラジオ
  const range = page.getByRole('radiogroup', { name: '期間' })
  for (const label of ['6ヶ月', '1年', '2年']) {
    await expectTapTargetSize(
      range.getByRole('radio', { name: label, exact: true }),
      `資産推移の期間（${label}）`,
      min,
    )
  }

  await page.goto('/expense-settlement')
  await expectTapTargetSize(
    page.getByRole('button', { name: '入金記録を追加' }),
    '精算の「入金記録」ボタン',
    min,
  )
})

/**
 * チェック行の受け皿を測る。
 *
 * チェックボックス本体は 13px ほどしかなく、押せる受け皿は行を包む `<label>` の側。
 * `<label>` が入力を包む関係が崩れて `htmlFor` + 兄弟要素になると、44px の `<label>` は
 * 残るのに実際の受け皿は 13px へ戻る。テストは緑のままなので、包含関係も併せて固定する。
 */
async function expectCheckRowSize(
  row: Locator,
  checkboxName: string | RegExp,
  name: string,
  min: number,
): Promise<void> {
  await expect(
    row.getByRole('checkbox', { name: checkboxName }),
    `${name} が入力を包む`,
  ).toHaveCount(1)
  await expectTapTargetSize(row, name, min)
}

test('取引一覧のチェック行・取引行・未分類の帯が下限の大きさを満たす', async ({ page }) => {
  await page.goto('/transactions')
  const min = await tapTargetMin(page)

  await expectCheckRowSize(
    page.locator('label').filter({ hasText: '未分類のみ' }),
    '未分類のみ',
    '取引一覧の「未分類のみ」チェック行',
    min,
  )
  // 取引 1 件ぶんの行。中身が 1 行に収まる取引でも押せる高さを割らない
  await expectTapTargetSize(page.locator('main ul li button').first(), '取引一覧の取引行', min)
  // 未分類を片付ける導線の帯。器（ui.card）より内側の余白に上書きしているぶん背が低い。
  // 中の `role="status"` のため役割からは名前で引けないので、要素と文字で指す
  await expectTapTargetSize(
    page.locator('button').filter({ hasText: '未分類の取引が' }),
    '未分類の取引の帯',
    min,
  )
})

test('設定の上限なしチェック行とさかのぼり候補行が下限の大きさを満たす', async ({ page }) => {
  await page.goto('/settings?section=limits')
  const min = await tapTargetMin(page)

  await page.getByRole('button', { name: '変更' }).first().click()
  await expectCheckRowSize(
    page.locator('label').filter({ hasText: '上限なし' }),
    /上限なし/,
    '月次上限の「上限なし」チェック行',
    min,
  )

  // さかのぼり再分類の候補行。ダイアログを開くまで出ないため導線をたどる
  await page.goto('/transactions')
  await page.getByRole('button', { name: /ドラッグストアA/ }).click()
  const detail = page.getByRole('dialog', { name: '未分類取引' })
  await detail.getByLabel('カテゴリ').selectOption({ label: '食費' })
  await detail.getByRole('button', { name: '分類を確定' }).click()

  const retroactive = page.getByRole('dialog', { name: '過去の取引にも適用' })
  await expectCheckRowSize(
    retroactive.locator('label').first(),
    /円$/,
    'さかのぼり再分類の候補行',
    min,
  )
})

test('画面が狭くても下部ナビが下限を保ったまま収まる', async ({ page }) => {
  // ナビの幅は 7 項目ぶんの下限で決まる（44 × 7 + 左右の余白 = 316px）。項目は縮まないので、
  // 想定する最小幅（320px）で下限と「はみ出さない」が両立することを境界として測る
  await page.setViewportSize({ width: 320, height: 720 })
  await page.goto('/')
  const min = await tapTargetMin(page)

  const nav = page.getByRole('navigation')
  for (const label of ['ホーム', '設定']) {
    await expectTapTargetSize(nav.getByRole('link', { name: label }), `下部ナビ（${label}）`, min)
  }

  const navBox = await nav.boundingBox()
  expect(navBox?.width ?? 0, '下部ナビの幅が画面幅に収まる').toBeLessThanOrEqual(320)
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(overflows, '横スクロールが出ていない').toBe(false)
})
