import { collectSources, isModuleCss } from './sources'

/**
 * CSS Modules の重複定義を調べるガードテストの共通部分。
 *
 * ファイルの集め方(走査規約)は `sources.ts` の `collectSources` に一本化し、
 * ここでは CSS Modules の重複検出という固有のロジックだけを持つ。
 */

/** `src` 配下の CSS Modules のパス一覧(`src` からの相対パス) */
export function listStylesheets(): string[] {
  return collectSources(isModuleCss).map(({ path }) => path)
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
  return collectSources(isModuleCss)
    .filter(({ path }) => !path.endsWith(ownerFile))
    .filter(({ content }) => pattern.test(content))
    .map(({ path }) => path)
}

/**
 * 集約先の CSS Modules が実際にそのクラスを定義しているか。
 *
 * 正本側がリネームされると {@link findDuplicateClassDefinitions} の除外条件が
 * 空振りし、ガードが常に green のまま集約の保証だけが消えるため、対で確認する
 */
export function definesClass(className: string, ownerFile: string): boolean {
  const pattern = new RegExp(String.raw`^\s*\.${className}\b`, 'm')
  const owner = collectSources(isModuleCss).find(({ path }) => path.endsWith(ownerFile))
  return owner !== undefined && pattern.test(owner.content)
}
