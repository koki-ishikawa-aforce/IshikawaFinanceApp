/**
 * CSS Modules をガードテストから読むための最小のルール分解。
 *
 * 宣言の有無を調べるテストが増えるたびに各テストが自前の正規表現を持つと、
 * コメントの落とし方や `@media` の扱いが少しずつ食い違い、片方だけ黙って
 * 見落とすようになる。分解のしかたはここ 1 か所に置く。
 */

/** CSS のルール(セレクタと宣言の組)。@media の入れ子は内側のルールが取れる */
const CSS_RULE = /([^{}]+)\{([^{}]*)\}/g

/** コメントはセレクタの手前に現れ、そのまま読むと本文の語をセレクタと誤認するため落とす */
export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

export interface CssRule {
  readonly selector: string
  readonly body: string
}

export function cssRules(css: string): CssRule[] {
  return [...stripComments(css).matchAll(CSS_RULE)].map(match => ({
    selector: (match[1] ?? '').trim(),
    body: match[2] ?? '',
  }))
}
