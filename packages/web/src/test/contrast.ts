/**
 * WCAG 2.1 のコントラスト比計算。`kpi-contrast.test.ts` と `badge-accent-contrast.test.ts` が
 * 共有する(トークンの組は異なるが、比較のしかたは同じため)。
 */

export type Rgb = readonly [number, number, number]

export function parseHex(hex: string): Rgb {
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
export function luminance([r, g, b]: Rgb): number {
  const channel = (value: number): number => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG 2.1 のコントラスト比(1〜21)。丸めずに返す(境界の 4.495 を通さないため) */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
}

/** グラデーションに含まれる色をすべて取り出す。単色ならその 1 色 */
export function colorStops(value: string): Rgb[] {
  return [...value.matchAll(/#[0-9a-fA-F]{3,6}\b/g)].map(match => parseHex(match[0]))
}
