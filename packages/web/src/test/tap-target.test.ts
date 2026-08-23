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

const TAP_TARGET_MIN = 'min-height: var(--tap-target-min);'

/** 下限を宣言していない共通の操作部品を返す */
function findControlsWithoutMin(common: string, controls: readonly string[]): string[] {
  const rules = cssRules(common)
  return controls.filter(selector => {
    const rule = rules.find(candidate => candidate.selector === selector)
    return rule === undefined || !rule.body.includes(TAP_TARGET_MIN)
  })
}

/**
 * min-height / min-width の px 直値。タップ下限に相当する大きさ(40〜60px)を
 * 書き起こしている箇所を探すために使う。`100dvh` や `min-width: 0` は対象外。
 */
const MIN_SIZE_DECLARATION = /(?:^|[;{\s])(min-(?:height|width))\s*:\s*(\d+)px/g

/** 下限の大きさとみなす範囲。44px の写しだけでなく 48px などの近似値も拾う */
const TAP_TARGET_RANGE = { min: 40, max: 60 } as const

/** タップ下限を px の直値で書き起こしている箇所を返す(`ファイル:セレクタ` 形式) */
function findHardcodedTapTargets(stylesheets: readonly Source[]): string[] {
  return stylesheets.flatMap(({ path, content }) =>
    cssRules(content)
      .filter(({ body }) =>
        [...body.matchAll(MIN_SIZE_DECLARATION)].some(match => {
          const px = Number(match[2])
          return px >= TAP_TARGET_RANGE.min && px <= TAP_TARGET_RANGE.max
        }),
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
    expect(globals).toMatch(/--tap-target-min:\s*44px;/)
    // 画面側で再定義すると「1 か所」でなくなる
    expect(stylesheets.filter(({ content }) => /--tap-target-min\s*:/.test(content))).toEqual([])
  })

  it('タップ下限を px の直値で書き起こしていない', () => {
    expect(findHardcodedTapTargets(stylesheets)).toEqual([])
  })

  it('レイアウト用途の min-height / min-width を違反と誤判定しない', () => {
    const valid: Source[] = [
      {
        path: 'valid.module.css',
        content: [
          '.main {\n  min-height: 100dvh;\n}',
          '.label {\n  min-width: 0;\n}',
          '.monthLabel {\n  min-width: 100px;\n}',
          '.bar {\n  min-width: 36px;\n}',
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
          '.unrelated {\n  min-height: 100dvh;\n}',
        ].join('\n'),
      },
    ]
    expect(findHardcodedTapTargets(offending)).toEqual([
      'offender.module.css:.tab',
      'offender.module.css:.iconButton',
      'offender.module.css:.fab',
    ])

    const missing = [
      '.button {\n  min-height: var(--tap-target-min);\n}',
      '.buttonGhost {\n  padding: var(--space-2) var(--space-3);\n}',
    ].join('\n')
    expect(findControlsWithoutMin(missing, ['.button', '.buttonGhost', '.select'])).toEqual([
      '.buttonGhost',
      '.select',
    ])
  })
})
