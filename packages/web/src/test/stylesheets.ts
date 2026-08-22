import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const SRC_DIR = join(import.meta.dirname, '..')

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })
}

/** `src` 配下の CSS Modules のパス一覧 */
export function listStylesheets(): string[] {
  return walk(SRC_DIR).filter(path => path.endsWith('.module.css'))
}

/**
 * 共通部品に集約したクラスが、他の CSS Modules で書き起こされていないか調べる。
 *
 * 検出できるのは「同じ名前で CSS に書かれた重複」だけ。別名クラスで書き起こす迂回は
 * 検出できないため、集約そのものの担保は各画面のテストで行う
 */
export function findDuplicateClassDefinitions(className: string, ownerFile: string): string[] {
  // `@media` ブロック内のインデントされた定義も拾う
  const pattern = new RegExp(String.raw`^\s*\.${className}\b`, 'm')
  return listStylesheets()
    .filter(path => !path.endsWith(ownerFile))
    .filter(path => pattern.test(readFileSync(path, 'utf8')))
}

/**
 * 集約先の CSS Modules が実際にそのクラスを定義しているか。
 *
 * 正本側がリネームされると {@link findDuplicateClassDefinitions} の除外条件が
 * 空振りし、ガードが常に green のまま集約の保証だけが消えるため、対で確認する
 */
export function definesClass(className: string, ownerFile: string): boolean {
  const pattern = new RegExp(String.raw`^\s*\.${className}\b`, 'm')
  const owner = listStylesheets().find(path => path.endsWith(ownerFile))
  return owner !== undefined && pattern.test(readFileSync(owner, 'utf8'))
}
