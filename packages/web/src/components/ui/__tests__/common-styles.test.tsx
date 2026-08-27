import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cssRules } from '@/test/css-rules'
import { SRC_DIR, collectSources, isModuleCss } from '@/test/sources'
import { definesClass, findDuplicateClassDefinitions, listStylesheets } from '@/test/stylesheets'

/**
 * 共通スタイルへ集約したクラスが、画面側の `*.module.css` に書き起こされていないことの
 * ガード(#462)。
 *
 * 集約前は同じ見た目が設定ページと学習タブに別々に書かれており、片方だけ直しても
 * もう片方が古いまま残った。名前が同じ重複はここで機械的に止める。
 *
 * `.note`(補足文)は値の違う定義が 3 画面に残っていたが、大きさ違いを共通側の
 * `.noteLg` として持たせて集約したためガードに載せている(#473)。あわせて、
 * `.finalizeNote` / `.hint` のように**別名で同じ宣言を書き起こす**迂回も止める。
 * 名前だけを見るガードでは、この形の重複を素通ししていた。
 */
const CONSOLIDATED = ['note', 'noteLg', 'warning', 'textButton', 'textButtonDanger'] as const

/**
 * 別名の重複を見るのは、宣言が 2 つ以上ある「見た目のまとまり」を持つクラスだけ。
 *
 * `.textButtonDanger` のような 1 宣言の修飾子(`color` だけ)は、まったく別の意味で
 * 同じ色を使うクラス(残高のマイナス表示など)と宣言が一致してしまい、書き起こしと
 * 区別できない。名前一致のガード(上のテスト)は全クラスに効いている。
 */
const ALIAS_GUARDED = ['note', 'noteLg', 'warning', 'textButton'] as const

const COMMON_CSS = 'common.module.css'

const COMMON_CSS_PATH = join('components', 'ui', COMMON_CSS)

/** 宣言の集合として比べる。順序と空白の違いは同じ見た目なので揃えてから比較する */
function declarations(body: string): string[] {
  return body
    .split(';')
    .map(declaration => declaration.trim().replace(/\s+/g, ' '))
    .filter(declaration => declaration.length > 0)
    .sort()
}

function ruleOf(content: string, className: string): string[] {
  const rule = cssRules(content).find(({ selector }) => selector === `.${className}`)
  return declarations(rule?.body ?? '')
}

describe('共通スタイルの重複定義の禁止', () => {
  it.each(CONSOLIDATED)('common.module.css 以外の .module.css に .%s が定義されていない', name => {
    // 走査自体が空振りしていないこと・正本が実際に定義していることを併せて確認する
    expect(listStylesheets().length).toBeGreaterThan(0)
    expect(definesClass(name, COMMON_CSS)).toBe(true)
    expect(findDuplicateClassDefinitions(name, COMMON_CSS)).toEqual([])
  })

  it.each(ALIAS_GUARDED)('別名のクラスが .%s と同じ宣言を書き起こしていない', name => {
    const common = readFileSync(join(SRC_DIR, COMMON_CSS_PATH), 'utf8')
    const target = ruleOf(common, name)
    expect(target.length).toBeGreaterThan(0)

    const aliases = collectSources(isModuleCss)
      .filter(({ path }) => path !== COMMON_CSS_PATH)
      .flatMap(({ path, content }) =>
        cssRules(content)
          .filter(({ body }) => declarations(body).join(';') === target.join(';'))
          .map(({ selector }) => `${path} ${selector}`),
      )
    expect(aliases).toEqual([])
  })
})

/**
 * 補足文の見た目そのものを固定する(#473)。
 *
 * 集約は「1 か所にまとめた」だけでは終わらず、まとめた先の値が意図どおりであることまでが
 * 成果物になる。行間・太さは VRT の許容比(1%)に吸収されて赤くならないため、宣言で押さえる。
 */
describe('補足文の共通クラス', () => {
  const common = (): string => readFileSync(join(SRC_DIR, COMMON_CSS_PATH), 'utf8')

  it('.note は極小の文字・補助色で、行間は共通トークンを使う', () => {
    expect(ruleOf(common(), 'note')).toEqual([
      'color: var(--text-secondary)',
      'font-size: var(--text-xs)',
      'line-height: var(--leading)',
    ])
  })

  it('.noteLg は .note との差を文字の大きさだけに保つ', () => {
    // 太さ・色を足すと画面ごとの見た目の分岐が共通側に戻ってくる
    expect(ruleOf(common(), 'noteLg')).toEqual(['composes: note', 'font-size: var(--text-sm)'])
  })

  it('.noteLg は .note より後ろに定義する(同じ詳細度では後勝ちのため)', () => {
    const selectors = cssRules(common()).map(({ selector }) => selector)
    expect(selectors.indexOf('.noteLg')).toBeGreaterThan(selectors.indexOf('.note'))
  })
})

/**
 * 行間のトークンを globals.css の 1 か所に閉じ込める(#473・#618)。
 *
 * stylelint は直値(`line-height: 1.5`)を止めるが、`var(--*)` の中身は見ない。
 * トークンを画面側で定義し直す迂回はここで止める(`icon-size-scale` と同じ形)。
 *
 * #618: `--leading-normal`(1.5)/ `--leading-relaxed`(1.6)の 2 段階は差が小さく
 * 使い分けが決めにくいという指摘を受け、`--leading`(1.6)の 1 種類に統一した。
 */
describe('行間のトークン', () => {
  it('globals.css の 1 か所に定義されている', () => {
    const globals = readFileSync(join(SRC_DIR, 'app', 'globals.css'), 'utf8')
    expect(globals).toMatch(/--leading:\s*1\.6;/)

    const redefined = collectSources(isModuleCss).filter(({ content }) =>
      /--leading\s*:/.test(content),
    )
    expect(redefined.map(({ path }) => path)).toEqual([])
  })

  // #618 で統合前に使っていた旧トークン名が var() の参照側に紛れ込むと、globals.css に
  // 定義が無いため静かに未指定(line-height: normal 相当)へフォールバックする。stylelint も
  // 上のガードも「未定義の var() 参照」までは見ないため、旧名そのものの残存をここで止める。
  it('統合前の --leading-normal / --leading-relaxed が残っていない', () => {
    const globals = readFileSync(join(SRC_DIR, 'app', 'globals.css'), 'utf8')
    const stale = [
      { path: 'app/globals.css', content: globals },
      ...collectSources(isModuleCss),
    ].filter(({ content }) => /--leading-(normal|relaxed)\b/.test(content))
    expect(stale.map(({ path }) => path)).toEqual([])
  })
})

/**
 * 取込ガイド(`StatementGuide`)の手順一覧の行間を固定する(#618)。
 *
 * `--leading-normal`(1.5)/ `--leading-relaxed`(1.6)を単一の `--leading`(1.6)に
 * 統合したとき、実際に値が変わったのはこの `.step` だけ(他は元々 1.6)。この画面の
 * パネルは既定で折りたたまれており(`hidden` 属性)、VRT は既定状態しか撮影しないため
 * 見た目の自動チェックでは検出できない。ここで宣言をリテラルに固定する。
 */
describe('取込ガイドの手順一覧', () => {
  it('.step の行間は共通トークンを使う', () => {
    const statementGuide = readFileSync(
      join(SRC_DIR, 'components', 'imports', 'StatementGuide.module.css'),
      'utf8',
    )
    expect(ruleOf(statementGuide, 'step')).toEqual(['line-height: var(--leading)'])
  })
})
