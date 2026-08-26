import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { alphaComposite, colorStops, contrastRatio, type Rgb } from './contrast'
import { cssRules } from './css-rules'
import { SRC_DIR, collectSources, isModuleCss } from './sources'

/**
 * 文字だけのボタン（`.textButton`、「改名」「編集」等）の文字が両テーマで読めることを
 * 数値で固定するガード(#600)。考え方は badge-accent-contrast.test.ts と同じ:
 * 見た目のスクリーンショット差分では 4.5:1 を割ったかどうかは判定できないため、
 * トークンの値そのものから比率を計算して固定する。
 *
 * `.textButton` は `background: none` で、現状は半透明カード(`.card`、
 * `rgba(255,255,255,0.7)`)越しに透ける `--bg-gradient` の上でしか使われていない
 * (`docs/design/usability.md` 8-6 の「半透明背景の上に淡色テキストを置く場合は
 * 実効値で判定する」)。ただし `.card` の外で使う保証はコードにないため、二段構えで
 * 固定する: (1) 素の `--bg-gradient`(カードを通さない、最も厳しい想定)に対して
 * 4.5:1、(2) 実際に `.card` を重ねた実効色に対しても 4.5:1。(1) を満たせば (2) は
 * 自動的に満たす(白を重ねるほど背景は明るくなりコントラストが緩む側に動くため)が、
 * (2) は実際の描画に即した比率を記録として残す意味で残す。
 */

/** `docs/design/usability.md` 8-6 / WCAG AA の本文の下限 */
const MIN_CONTRAST = 4.5

/** `.card` の不透明度(`packages/web/src/components/ui/common.module.css` の `.card`) */
const CARD_OPACITY = 0.7

const GLOBALS_CSS = readFileSync(join(SRC_DIR, 'app', 'globals.css'), 'utf8')

const ACCENT_TEXT = '--accent-text'
const WHITE = '--white'
const BG_GRADIENT = '--bg-gradient'

/** `:root`(だーりん)と `[data-theme='honey']` のトークン定義 */
function themeBlock(theme: 'darling' | 'honey'): string {
  const selector = theme === 'darling' ? ':root' : "[data-theme='honey']"
  return cssRules(GLOBALS_CSS)
    .filter(rule => rule.selector === selector)
    .map(rule => rule.body)
    .join('\n')
}

/** そのテーマで効くブロック。はにーは `:root` を上書きするので、後勝ちで解決する */
function blocksOf(theme: 'darling' | 'honey'): string[] {
  return theme === 'darling'
    ? [themeBlock('darling')]
    : [themeBlock('darling'), themeBlock('honey')]
}

/** そのテーマで効くトークンの値 */
function tokenValue(theme: 'darling' | 'honey', token: string): string {
  const values = blocksOf(theme).flatMap(block =>
    [...block.matchAll(new RegExp(String.raw`${token}\s*:\s*([^;]+);`, 'g'))].map(m =>
      (m[1] ?? '').trim(),
    ),
  )
  return values.at(-1) ?? ''
}

describe('文字だけのボタンのコントラスト', () => {
  for (const theme of ['darling', 'honey'] as const) {
    it(`${theme}: 文字色が背景グラデーションのどの停止点に対しても 4.5:1 以上ある`, () => {
      const textColors = colorStops(tokenValue(theme, ACCENT_TEXT))
      const gradientStops = colorStops(tokenValue(theme, BG_GRADIENT))
      const white = colorStops(tokenValue(theme, WHITE))
      // トークン名を変えたときに「対象 0 件で緑」にならないよう、読めていることを先に確認する
      expect(textColors, `${ACCENT_TEXT} の色を読み取れている`).toHaveLength(1)
      expect(gradientStops.length, `${BG_GRADIENT} の色を読み取れている`).toBeGreaterThan(0)
      expect(white, `${WHITE} の色を読み取れている`).toHaveLength(1)

      for (const stop of gradientStops) {
        // 素のグラデーション(カードを通さない)に対する比率。実際に見える背景は
        // これより白側に寄る(コントラストが緩む)ため、ここを満たせば実描画でも満たす
        const ratio = contrastRatio(textColors[0] as Rgb, stop)
        expect(
          ratio,
          `${theme}: rgb(${stop.join(',')}) に対する比が ${ratio.toFixed(2)}`,
        ).toBeGreaterThanOrEqual(MIN_CONTRAST)
      }
    })

    it(`${theme}: .card 越しに実際に見える背景に対しても 4.5:1 以上ある`, () => {
      // 上のテストは「素のグラデーション」という厳しめの近似で判定しているが、
      // ここでは .card(白 70%)を実際に重ねた実効色でも満たすことを直接確認する
      const textColors = colorStops(tokenValue(theme, ACCENT_TEXT))
      const gradientStops = colorStops(tokenValue(theme, BG_GRADIENT))
      const white = colorStops(tokenValue(theme, WHITE))
      expect(textColors).toHaveLength(1)
      expect(white).toHaveLength(1)

      for (const stop of gradientStops) {
        const effective = alphaComposite(white[0] as Rgb, CARD_OPACITY, stop)
        const ratio = contrastRatio(textColors[0] as Rgb, effective)
        expect(
          ratio,
          `${theme}: .card 越しの rgb(${effective.map(v => v.toFixed(1)).join(',')}) に対する比が ${ratio.toFixed(2)}`,
        ).toBeGreaterThanOrEqual(MIN_CONTRAST)
      }
    })
  }

  it('文字だけのボタンの文字色を、.textButton 以外に流用していない', () => {
    // 濃さは .card 越しの背景で読める前提で決めており、暗い面に載せると沈む余地がある。
    // その配色はトークンの組からは見えないため、使う側を .textButton に限定する
    const stylesheets = collectSources(isModuleCss)
    const users = stylesheets.filter(({ content }) =>
      new RegExp(String.raw`color\s*:\s*var\(\s*${ACCENT_TEXT}\s*\)`).test(content),
    )
    // 走査が空振りしていないこと(使う側が 0 件なら、このガードは何も守っていない)
    expect(users.length).toBeGreaterThan(0)

    const offenders = users
      .flatMap(({ path, content }) =>
        cssRules(content)
          .filter(rule =>
            new RegExp(String.raw`color\s*:\s*var\(\s*${ACCENT_TEXT}\s*\)`).test(rule.body),
          )
          .map(rule => `${path}:${rule.selector}`),
      )
      .filter(location => !/\.textButton\b/.test(location))
    expect(offenders).toEqual([])
  })
})
