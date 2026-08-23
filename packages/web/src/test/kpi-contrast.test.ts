import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cssRules } from './css-rules'
import { SRC_DIR, collectSources, isModuleCss } from './sources'

/**
 * 金額カードの文字が両テーマで読めることを数値で固定するガード(#366)。
 *
 * 金額カードは背景がテーマ色のグラデーションで、文字色は 1 つのトークン
 * (`--text-on-kpi`)で決まる。トークンの色を少し動かすだけで片方のテーマだけ
 * 読めなくなるが、見た目のスクリーンショット差分では「変わったこと」しか分からず、
 * 4.5:1 を割ったかどうかは判定できない。ここで比率そのものを固定する。
 *
 * 守らせるのは 4 つ:
 * 1. 文字色が、そのテーマの対応する背景すべてに対して 4.5:1 以上
 * 2. 金額カードの上の文字を半透明にしていない(背景が透けたぶん比率が落ちるため)
 * 3. 金額カードの文字色を、金額カード以外の面に流用していない
 * 4. 比率の計算そのものが壊れていない
 */

/** `docs/design/usability.md` 8-6 / WCAG AA の本文の下限 */
const MIN_CONTRAST = 4.5

const GLOBALS_CSS = readFileSync(join(SRC_DIR, 'app', 'globals.css'), 'utf8')

/** 金額カードの文字色 */
const TEXT_ON_KPI = '--text-on-kpi'

/**
 * 金額カードの背景トークンの見分け方。
 *
 * 手書きで列挙すると `--kpi-2` を足したときに黙って対象外になるため、接頭辞で拾う
 */
const KPI_BACKGROUND = /^--kpi-/

type Rgb = readonly [number, number, number]

function parseHex(hex: string): Rgb {
  const body = hex.replace('#', '')
  const full =
    body.length === 3
      ? body
          .split('')
          .map(c => c + c)
          .join('')
      : body
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ]
}

/** WCAG 2.1 の相対輝度 */
function luminance([r, g, b]: Rgb): number {
  const channel = (value: number): number => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG 2.1 のコントラスト比(1〜21)。丸めずに返す(境界の 4.495 を通さないため) */
function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
}

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

/** そのテーマで定義されているトークン名(重複は除く) */
function tokenNames(theme: 'darling' | 'honey'): string[] {
  const names = blocksOf(theme).flatMap(block =>
    [...block.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1] ?? ''),
  )
  return [...new Set(names)]
}

/** グラデーションに含まれる色をすべて取り出す。単色ならその 1 色 */
function colorStops(value: string): Rgb[] {
  return [...value.matchAll(/#[0-9a-fA-F]{3,6}\b/g)].map(match => parseHex(match[0]))
}

/**
 * 見張る文字色と、その上に載る背景トークンの組。
 *
 * `--text-on-kpi` はだーりんで濃色にしたため、濃い面(`--text-primary` を背景に使う吹き出し)へ
 * 流用すると読めなくなる。逆にその吹き出しは白で固定した。どちらも組として押さえる
 */
function pairs(theme: 'darling' | 'honey'): { text: string; backgrounds: string[] }[] {
  return [
    { text: TEXT_ON_KPI, backgrounds: tokenNames(theme).filter(name => KPI_BACKGROUND.test(name)) },
    // 配偶者の個人費の吹き出し(SpousePersonalNote の .hint)
    { text: '--white', backgrounds: ['--text-primary'] },
  ]
}

describe('金額カードのコントラスト', () => {
  for (const theme of ['darling', 'honey'] as const) {
    it(`${theme}: 文字色が背景すべてに対して 4.5:1 以上ある`, () => {
      for (const { text, backgrounds } of pairs(theme)) {
        const textColors = colorStops(tokenValue(theme, text))
        // トークン名を変えたときに「対象 0 件で緑」にならないよう、読めていることを先に確認する
        expect(textColors, `${text} の色を読み取れている`).toHaveLength(1)
        expect(backgrounds.length, `${text} に対応する背景を 1 つ以上見ている`).toBeGreaterThan(0)

        for (const background of backgrounds) {
          const stops = colorStops(tokenValue(theme, background))
          expect(stops.length, `${background} の色を読み取れている`).toBeGreaterThan(0)
          for (const stop of stops) {
            const ratio = contrastRatio(textColors[0] as Rgb, stop)
            expect(
              ratio,
              `${theme}: ${text} と ${background} の色 rgb(${stop.join(',')}) の比が ${ratio.toFixed(2)}`,
            ).toBeGreaterThanOrEqual(MIN_CONTRAST)
          }
        }
      }
    })
  }

  it('金額カードの文字と面を半透明にしていない', () => {
    // 半透明にすると背景が透けて実際の比率が落ちる(0.95 でも 4.5:1 を割る)。
    // 上のテストは不透明を前提に計算しているため、前提が崩れていないことを併せて固定する。
    // 文字側だけでなく、面(--kpi-* を背景に敷くルール)の半透明も同じ結果になるので見る
    const declaresOpacity = (body: string): boolean => /(?:^|[;{\s])opacity\s*:/.test(body)
    const usesTextOnKpi = (body: string): boolean =>
      new RegExp(String.raw`color\s*:\s*var\(\s*${TEXT_ON_KPI}\s*\)`).test(body)
    const usesKpiBackground = (body: string): boolean =>
      /background\s*:\s*var\(\s*--kpi-/.test(body)

    const offenders = collectSources(isModuleCss).flatMap(({ path, content }) =>
      cssRules(content)
        .filter(
          ({ body }) => (usesTextOnKpi(body) || usesKpiBackground(body)) && declaresOpacity(body),
        )
        .map(({ selector }) => `${path}:${selector}`),
    )
    expect(offenders).toEqual([])
  })

  it('金額カードの文字色を、金額カード以外の面に流用していない', () => {
    // だーりんの --text-on-kpi は濃色。--text-primary の吹き出しに流用すると 1.37:1 になるが、
    // その配色はトークンの組からは見えないため、使う側を縛って流用そのものを止める
    const stylesheets = collectSources(isModuleCss)
    const users = stylesheets.filter(({ content }) =>
      new RegExp(String.raw`color\s*:\s*var\(\s*${TEXT_ON_KPI}\s*\)`).test(content),
    )
    // 走査が空振りしていないこと(使う側が 0 件なら、このガードは何も守っていない)
    expect(users.length).toBeGreaterThan(0)

    const offenders = users
      .filter(({ content }) => !/background\s*:\s*var\(\s*--kpi-/.test(content))
      .map(({ path }) => path)
    expect(offenders).toEqual([])
  })

  it('比率の計算が既知の値と一致する', () => {
    // 計算そのものが壊れると、上のテストが常に緑になる
    expect(contrastRatio(parseHex('#ffffff'), parseHex('#000000'))).toBeCloseTo(21, 5)
    expect(contrastRatio(parseHex('#ffffff'), parseHex('#ffffff'))).toBeCloseTo(1, 5)
    // 修正前のはにーの金額カード(白文字 × #80a8d0)。下限を割る組み合わせを検出できる
    expect(contrastRatio(parseHex('#ffffff'), parseHex('#80a8d0'))).toBeLessThan(MIN_CONTRAST)
    // だーりんの文字色を吹き出し(--text-primary)へ流用した場合。使う側のガードが守る配色
    expect(contrastRatio(parseHex('#3d1420'), parseHex('#5a2840'))).toBeLessThan(MIN_CONTRAST)
  })
})
