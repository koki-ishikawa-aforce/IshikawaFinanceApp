import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { colorStops, contrastRatio, type Rgb } from './contrast'
import { cssRules } from './css-rules'
import { SRC_DIR, collectSources, isModuleCss } from './sources'

/**
 * 強調バッジ（`.badgeAccent`、「確認済み」「完了」等）の文字が両テーマで読めることを
 * 数値で固定するガード(#545)。考え方は kpi-contrast.test.ts と同じ:
 * 見た目のスクリーンショット差分では 4.5:1 を割ったかどうかは判定できないため、
 * トークンの値そのものから比率を計算して固定する。
 */

/** `docs/design/usability.md` 8-6 / WCAG AA の本文の下限 */
const MIN_CONTRAST = 4.5

const GLOBALS_CSS = readFileSync(join(SRC_DIR, 'app', 'globals.css'), 'utf8')

const BADGE_ACCENT_TEXT = '--badge-accent-text'
const BADGE_ACCENT_BG = '--badge-accent-bg'

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

/**
 * トークンの値を色として解決する。`--badge-accent-bg` はだーりんで `var(--accent)` を
 * 参照しているため、値がトークン名ならもう一段解決する
 */
function resolveColor(theme: 'darling' | 'honey', value: string): Rgb[] {
  const ref = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value)
  return ref ? colorStops(tokenValue(theme, ref[1] as string)) : colorStops(value)
}

describe('強調バッジのコントラスト', () => {
  for (const theme of ['darling', 'honey'] as const) {
    it(`${theme}: 文字色が背景に対して 4.5:1 以上ある`, () => {
      const textColors = resolveColor(theme, tokenValue(theme, BADGE_ACCENT_TEXT))
      const bgColors = resolveColor(theme, tokenValue(theme, BADGE_ACCENT_BG))
      // トークン名を変えたときに「対象 0 件で緑」にならないよう、読めていることを先に確認する
      expect(textColors, `${BADGE_ACCENT_TEXT} の色を読み取れている`).toHaveLength(1)
      expect(bgColors, `${BADGE_ACCENT_BG} の色を読み取れている`).toHaveLength(1)

      const ratio = contrastRatio(textColors[0] as Rgb, bgColors[0] as Rgb)
      expect(ratio, `${theme}: 比が ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(MIN_CONTRAST)
    })
  }

  it('強調バッジの文字色を、強調バッジ以外の面に流用していない', () => {
    // だーりんの --badge-accent-text は濃色。--badge-accent-bg 以外の面に流用すると
    // 読めなくなる余地があるが、その配色はトークンの組からは見えないため、使う側を縛る
    const stylesheets = collectSources(isModuleCss)
    const users = stylesheets.filter(({ content }) =>
      new RegExp(String.raw`color\s*:\s*var\(\s*${BADGE_ACCENT_TEXT}\s*\)`).test(content),
    )
    // 走査が空振りしていないこと(使う側が 0 件なら、このガードは何も守っていない)
    expect(users.length).toBeGreaterThan(0)

    const offenders = users
      .filter(
        ({ content }) =>
          !new RegExp(String.raw`background\s*:\s*var\(\s*${BADGE_ACCENT_BG}\s*\)`).test(content),
      )
      .map(({ path }) => path)
    expect(offenders).toEqual([])
  })
})
