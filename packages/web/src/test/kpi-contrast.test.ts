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
 * 守らせるのは 2 つ:
 * 1. 文字色が、そのテーマの金額カード背景すべてに対して 4.5:1 以上
 * 2. 金額カードの上の文字を半透明にしていない(背景が透けたぶん比率が落ちるため)
 */

/** `docs/design/usability.md` 8-6 / WCAG AA の本文の下限 */
const MIN_CONTRAST = 4.5

const GLOBALS_CSS = readFileSync(join(SRC_DIR, 'app', 'globals.css'), 'utf8')

/** 金額カードの背景に使うトークン。両方とも文字色 1 つで賄うため、まとめて見る */
const BACKGROUND_TOKENS = ['--kpi-1', '--kpi-hero'] as const
const TEXT_TOKEN = '--text-on-kpi'

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

/** WCAG 2.1 のコントラスト比(1〜21) */
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

/** そのテーマで効くトークンの値。はにーは `:root` を上書きするので、後勝ちで解決する */
function tokenValue(theme: 'darling' | 'honey', token: string): string {
  const blocks =
    theme === 'darling' ? [themeBlock('darling')] : [themeBlock('darling'), themeBlock('honey')]
  const values = blocks.flatMap(block =>
    [...block.matchAll(new RegExp(String.raw`${token}\s*:\s*([^;]+);`, 'g'))].map(m =>
      (m[1] ?? '').trim(),
    ),
  )
  return values.at(-1) ?? ''
}

/** グラデーションに含まれる色をすべて取り出す。単色ならその 1 色 */
function colorStops(value: string): Rgb[] {
  return [...value.matchAll(/#[0-9a-fA-F]{3,6}\b/g)].map(match => parseHex(match[0]))
}

describe('金額カードのコントラスト', () => {
  for (const theme of ['darling', 'honey'] as const) {
    it(`${theme}: 文字色が金額カードの背景すべてに対して 4.5:1 以上ある`, () => {
      const text = colorStops(tokenValue(theme, TEXT_TOKEN))
      // トークン名を変えたときに「対象 0 件で緑」にならないよう、読めていることを先に確認する
      expect(text).toHaveLength(1)

      const backgrounds = BACKGROUND_TOKENS.flatMap(token => {
        const stops = colorStops(tokenValue(theme, token))
        expect(stops.length, `${token} の色を読み取れている`).toBeGreaterThan(0)
        return stops.map(stop => ({ token, stop }))
      })

      for (const { token, stop } of backgrounds) {
        const ratio = contrastRatio(text[0] as Rgb, stop)
        expect(
          Number(ratio.toFixed(2)),
          `${theme} の ${TEXT_TOKEN} と ${token} の色 rgb(${stop.join(',')})`,
        ).toBeGreaterThanOrEqual(MIN_CONTRAST)
      }
    })
  }

  it('金額カードの上の文字を半透明にしていない', () => {
    // 半透明にすると背景が透けて実際の比率が落ちる(0.95 でも 4.5:1 を割る)。
    // 上のテストは不透明を前提に計算しているため、前提が崩れていないことを併せて固定する
    const offenders = collectSources(isModuleCss).flatMap(({ path, content }) =>
      cssRules(content)
        .filter(
          ({ body }) =>
            new RegExp(String.raw`color\s*:\s*var\(\s*${TEXT_TOKEN}\s*\)`).test(body) &&
            /(?:^|[;{\s])opacity\s*:/.test(body),
        )
        .map(({ selector }) => `${path}:${selector}`),
    )
    expect(offenders).toEqual([])
  })

  it('比率の計算が既知の値と一致する', () => {
    // 計算そのものが壊れると、上の 2 つが常に緑になる
    expect(contrastRatio(parseHex('#ffffff'), parseHex('#000000'))).toBeCloseTo(21, 5)
    expect(contrastRatio(parseHex('#ffffff'), parseHex('#ffffff'))).toBeCloseTo(1, 5)
    // 修正前のはにーの金額カード(白文字 × #80a8d0)。下限を割る組み合わせを検出できる
    expect(contrastRatio(parseHex('#ffffff'), parseHex('#80a8d0'))).toBeLessThan(MIN_CONTRAST)
  })
})
