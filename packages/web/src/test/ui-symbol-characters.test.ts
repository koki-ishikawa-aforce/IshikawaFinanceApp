import { readFileSync, readdirSync } from 'node:fs'
import { join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

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

/** vitest の root は packages/web なので、そこからの相対で src を辿る */
const SRC_DIR = join(process.cwd(), 'src')

/** UI 文言は .tsx だけでなく .ts のラベル定義にも置かれるため、両方を走査する */
function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      // __tests__ とこのガード自身の置き場は、記号を検証データとして持ちうるので除外する
      return entry.name === '__tests__' || entry.name === 'test' ? [] : collectSourceFiles(path)
    }
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

function findOffenders(files: readonly string[], char: string): string[] {
  return files
    .filter(path => readFileSync(path, 'utf8').includes(char))
    .map(path => path.slice(SRC_DIR.length + sep.length))
}

describe('UI テキストの記号文字', () => {
  const files = collectSourceFiles(SRC_DIR)

  it.each(FORBIDDEN)('$name を含むソースが無い', ({ code }) => {
    expect(findOffenders(files, String.fromCodePoint(code))).toEqual([])
  })

  it('記号を置き換えた画面のソースを走査対象に含めている', () => {
    // 走査が対象を取りこぼしていると、上のテストは中身が空のまま緑になる
    expect(files.map(path => path.slice(SRC_DIR.length + sep.length))).toEqual(
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
    const guardItself = join(SRC_DIR, 'test', 'ui-symbol-characters.test.ts')
    expect(findOffenders([guardItself], 'FORBIDDEN')).toHaveLength(1)
  })
})
