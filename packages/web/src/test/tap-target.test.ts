import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cssRules } from './css-rules'
import { SRC_DIR, collectSources, isModuleCss, type Source } from './sources'

/**
 * タップターゲットの下限(`docs/design/usability.md` §4-3)を機械的に守るガード(#568)。
 *
 * 押す・触る操作の受け皿は最小 44×44px を確保する。padding とフォントサイズの合計で
 * 満たそうとすると、文字を 1 段小さくしただけで下限を割り、見た目には気づけない
 * (実際に共通ボタンは縦パディング 8px + フォント 12px で実効高 約30px だった)。
 * 色・余白・角丸・フォントサイズのトークン利用は stylelint が縛っているが、
 * min-height はレイアウト用途(`min-height: 100dvh` 等)と区別できないため縛れない。
 * そこで「操作部品の下限」に限ってここで縛る。
 *
 * 守らせるのは次の 3 つ:
 * 1. 共通の操作部品(ボタン・選択欄・入力欄)が下限をトークンで宣言している
 * 2. 下限の値が globals.css の 1 か所だけに定義されている
 * 3. 下限に相当する大きさを px の直値で書き起こしていない
 */

/** 下限を宣言していなければならない共通の操作部品(`components/ui/common.module.css`) */
const COMMON_CONTROLS = ['.button', '.buttonGhost', '.buttonDanger', '.select', '.input'] as const

const COMMON_CSS = join('components', 'ui', 'common.module.css')

const TAP_TARGET_MIN = 'var(--tap-target-min)'

/** `min-height` の宣言。同じセレクタに複数あるときは後の宣言が実際に効く */
const MIN_HEIGHT_DECLARATION = /(?:^|[;{\s])min-height\s*:\s*([^;}]+)/g

/**
 * 下限が効いていない共通の操作部品を返す。
 *
 * 同じセレクタは 1 つとは限らない。後ろに `.button { min-height: 0 }` を足せば実効高は
 * 潰せるので、最初の宣言ではなく**最後に効く宣言**がトークン参照かどうかで判定する。
 */
function findControlsWithoutMin(common: string, controls: readonly string[]): string[] {
  const rules = cssRules(common)
  return controls.filter(selector => {
    const declarations = rules
      .filter(rule => rule.selector === selector)
      .flatMap(rule => [...rule.body.matchAll(MIN_HEIGHT_DECLARATION)].map(match => match[1] ?? ''))
    const effective = declarations.at(-1)
    return effective === undefined || !effective.includes(TAP_TARGET_MIN)
  })
}

/** 大きさの px 直値。`min-` の有無で扱いを変えるため、接頭辞も取り出す */
const SIZE_DECLARATION = /(?:^|[;{\s])((?:min-)?(?:height|width))\s*:\s*(\d+)px/g

/** 下限の宣言とみなす範囲。44px の写しだけでなく 48px などの近似値も拾う */
const TAP_TARGET_RANGE = { min: 40, max: 60 } as const

/** トークン `--tap-target-min` の値。大きさを固定する書き方はこの値と同じときだけ写しとみなす */
const TAP_TARGET_PX = 44

/**
 * その宣言がタップ下限の書き起こしかを判定する。
 *
 * `min-height` / `min-width` は下限そのものの指定なので、下限とみなせる範囲(40〜60px)を
 * 直値で書いていれば写し。`height` / `width` は本来レイアウトの指定で、40px の飾り円など
 * 正当な用途があるため、下限の値そのもの(44px)と一致するときだけ写しとみなす。
 */
function isHardcodedTapTarget(property: string, px: number): boolean {
  return property.startsWith('min-')
    ? px >= TAP_TARGET_RANGE.min && px <= TAP_TARGET_RANGE.max
    : px === TAP_TARGET_PX
}

/** タップ下限を px の直値で書き起こしている箇所を返す(`ファイル:セレクタ` 形式) */
function findHardcodedTapTargets(stylesheets: readonly Source[]): string[] {
  return stylesheets.flatMap(({ path, content }) =>
    cssRules(content)
      .filter(({ body }) =>
        [...body.matchAll(SIZE_DECLARATION)].some(match =>
          isHardcodedTapTarget(match[1] ?? '', Number(match[2])),
        ),
      )
      .map(({ selector }) => `${path}:${selector}`),
  )
}

describe('タップターゲットの下限', () => {
  const stylesheets = collectSources(isModuleCss)
  const common = stylesheets.find(({ path }) => path === COMMON_CSS)?.content ?? ''

  it('共通の操作部品が下限をトークンで宣言している', () => {
    expect(findControlsWithoutMin(common, COMMON_CONTROLS)).toEqual([])
  })

  it('下限の値が globals.css の 1 か所に定義されている', () => {
    const globals = readFileSync(join(SRC_DIR, 'app', 'globals.css'), 'utf8')
    const definitions = [...globals.matchAll(/--tap-target-min\s*:\s*([^;]+);/g)].map(
      match => match[1],
    )
    // テーマごとに 2 度目の定義を足されると、画面によって下限が変わる
    expect(definitions).toEqual([`${TAP_TARGET_PX}px`])
    // 画面側で再定義しても「1 か所」でなくなる。失敗時に CSS 全文が出ないようパスで比べる
    expect(
      stylesheets.filter(({ content }) => /--tap-target-min\s*:/.test(content)).map(s => s.path),
    ).toEqual([])
  })

  it('ボタンの見た目のリンクがボタン種別の後ろで display を上書きしている', () => {
    // `<a>` は既定が inline で min-height が効かないため、`.buttonLink` の display 指定が
    // 下限の成立条件になる。同じ詳細度では後勝ちなので、ボタン種別より前に置くと無効になる
    const selectors = cssRules(common).map(({ selector }) => selector)
    const link = selectors.lastIndexOf('.buttonLink')
    expect(link).toBeGreaterThan(-1)
    for (const variant of ['.button', '.buttonGhost', '.buttonDanger']) {
      expect(selectors.lastIndexOf(variant), `${variant} より後ろにある`).toBeLessThan(link)
    }
    const body = cssRules(common).find(({ selector }) => selector === '.buttonLink')?.body ?? ''
    expect(body).toMatch(/display\s*:\s*flex/)
  })

  it('タップ下限を px の直値で書き起こしていない', () => {
    expect(findHardcodedTapTargets(stylesheets)).toEqual([])
  })

  it('レイアウト用途の大きさ指定を違反と誤判定しない', () => {
    const valid: Source[] = [
      {
        path: 'valid.module.css',
        content: [
          '.main {\n  min-height: 100dvh;\n}',
          '.label {\n  min-width: 0;\n}',
          '.monthLabel {\n  min-width: 100px;\n}',
          '.bar {\n  min-width: 36px;\n}',
          // 範囲のすぐ外側。ここを拾うと下限と無関係な指定まで書き換えさせることになる
          '.justBelow {\n  min-height: 39px;\n}',
          '.justAbove {\n  min-height: 61px;\n}',
          // 大きさの固定は下限と同じ値のときだけ写しとみなす(飾りの円など正当な用途がある)
          '.avatar {\n  width: 40px;\n  height: 40px;\n}',
          '.button {\n  min-height: var(--tap-target-min);\n}',
        ].join('\n'),
      },
    ]
    expect(findHardcodedTapTargets(valid)).toEqual([])
  })

  it('違反を検出できる', () => {
    // 検出ロジック自体が壊れると 0 件のまま緑になるため、既知の違反例で固定する
    const offending: Source[] = [
      {
        path: 'offender.module.css',
        content: [
          '.tab {\n  min-height: 44px;\n}',
          '.iconButton {\n  min-width: 48px;\n  min-height: 48px;\n}',
          '@media (max-width: 320px) {\n  .fab {\n    min-height: 56px;\n  }\n}',
          // 範囲の端。ここを外すと 40px / 60px の書き起こしが素通りする
          '.edgeLow {\n  min-height: 40px;\n}',
          '.edgeHigh {\n  min-width: 60px;\n}',
          // 大きさの固定でも、下限そのものの値なら写し
          '.circle {\n  width: 44px;\n  height: 44px;\n}',
          '.unrelated {\n  min-height: 100dvh;\n}',
        ].join('\n'),
      },
    ]
    expect(findHardcodedTapTargets(offending)).toEqual([
      'offender.module.css:.tab',
      'offender.module.css:.iconButton',
      'offender.module.css:.fab',
      'offender.module.css:.edgeLow',
      'offender.module.css:.edgeHigh',
      'offender.module.css:.circle',
    ])

    const missing = [
      '.button {\n  min-height: var(--tap-target-min);\n}',
      '.buttonGhost {\n  padding: var(--space-2) var(--space-3);\n}',
    ].join('\n')
    expect(findControlsWithoutMin(missing, ['.button', '.buttonGhost', '.select'])).toEqual([
      '.buttonGhost',
      '.select',
    ])

    // 後ろのルールで下限を打ち消す書き方も見逃さない(最後に効く宣言で判定する)
    const overridden = [
      '.button {\n  min-height: var(--tap-target-min);\n}',
      '.button:disabled {\n  opacity: 0.4;\n}',
      '.button {\n  min-height: 0;\n}',
    ].join('\n')
    expect(findControlsWithoutMin(overridden, ['.button'])).toEqual(['.button'])
  })
})
