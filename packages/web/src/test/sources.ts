import { readFileSync, readdirSync } from 'node:fs'
import { join, sep } from 'node:path'

/**
 * ソースを走査するガードテスト(`ui-symbol-characters` / `icon-size-scale`)の共通土台。
 *
 * 走査規約(どのディレクトリを見て、どこを除外するか)を各テストが自前で持つと、
 * 片方の除外規則を変えたときにもう片方の網羅範囲が黙って食い違う。
 */

export interface Source {
  /** `src` からの相対パス。違反の報告に使う */
  readonly path: string
  readonly content: string
}

/** vitest の root は packages/web なので、そこからの相対で src を辿る */
export const SRC_DIR = join(process.cwd(), 'src')

/**
 * `src` 配下のソースを集める。
 *
 * `__tests__` とガードの置き場(`test`)は、違反例を検証データとして持ちうるので除外する。
 */
export function collectSources(match: (name: string) => boolean, dir: string = SRC_DIR): Source[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name === '__tests__' || entry.name === 'test' ? [] : collectSources(match, path)
    }
    if (!entry.isFile() || !match(entry.name)) return []
    return [{ path: path.slice(SRC_DIR.length + sep.length), content: readFileSync(path, 'utf8') }]
  })
}

export const isTsx = (name: string): boolean => name.endsWith('.tsx')
/** UI 文言は .tsx だけでなく .ts のラベル定義にも置かれる */
export const isTsOrTsx = (name: string): boolean => /\.tsx?$/.test(name)
export const isModuleCss = (name: string): boolean => name.endsWith('.module.css')
