import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectSources, isTsOrTsx, type Source } from './sources'

/**
 * 記号文字を UI テキストとして使わせないためのリグレッションガード(#344)。
 *
 * これらは表示書体が端末まかせで、日本語書体を持たない環境では豆腐(□)に化ける。
 * `DESIGN.md` §4 は「装飾も情報伝達もアイコン部品(react-icons)か CSS で表現する」と
 * 定めており、CSS 側の直値は stylelint が機械的に禁止しているが、JSX 側には同等の
 * 機械チェックが無い。
 *
 * 矢印(→)は対象にしていない。オンボーディング画面の説明文(「A → B の順で完了する」等)
 * のように文章の一部として正当に現れるため、一律に禁止すると使えるルールにならない。
 *
 * 禁止文字はコードポイントで表す。文字リテラルで書くとこのファイル自身が検出対象になる。
 */
const FORBIDDEN = [
  { code: 0x25c0, name: 'BLACK LEFT-POINTING TRIANGLE' },
  { code: 0x25b6, name: 'BLACK RIGHT-POINTING TRIANGLE' },
  { code: 0xff0b, name: 'FULLWIDTH PLUS SIGN' },
  { code: 0x203a, name: 'SINGLE RIGHT-POINTING ANGLE QUOTATION MARK' },
] as const

/** 走査規約（対象の拡張子・除外ディレクトリ）は `sources.ts` に集約している */
function findOffenders(sources: readonly Source[], char: string): string[] {
  return sources.filter(({ content }) => content.includes(char)).map(({ path }) => path)
}

describe('UI テキストの記号文字', () => {
  // UI 文言は .tsx だけでなく .ts のラベル定義にも置かれるため、両方を走査する
  const sources = collectSources(isTsOrTsx)

  it.each(FORBIDDEN)('$name を含むソースが無い', ({ code }) => {
    expect(findOffenders(sources, String.fromCodePoint(code))).toEqual([])
  })

  it('記号を置き換えた画面のソースを走査対象に含めている', () => {
    // 走査が対象を取りこぼしていると、上のテストは中身が空のまま緑になる
    expect(sources.map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        join('app', 'transactions', 'page.tsx'),
        join('app', 'settings', 'page.tsx'),
        join('app', 'expense-settlement', 'page.tsx'),
        join('components', 'dashboard', 'MonthNavigator.tsx'),
        join('components', 'dashboard', 'CategoryBreakdown.tsx'),
        join('lib', 'labels.ts'),
      ]),
    )
  })

  it('禁止文字を含むファイルを検出できる', () => {
    // 検出ロジック自体が壊れると全件 0 件で緑になるため、既知の陽性で固定する
    const guardItself: Source = { path: 'guard.ts', content: 'const FORBIDDEN = []' }
    expect(findOffenders([guardItself], 'FORBIDDEN')).toEqual(['guard.ts'])
  })
})
