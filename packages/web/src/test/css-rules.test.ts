import { describe, expect, it } from 'vitest'
import { cssRules, stripComments } from './css-rules'

/**
 * ガードテストの土台(`css-rules.ts`)そのものの検査。
 *
 * 分解が静かに壊れると、これを使う側(`icon-size-scale` / `tap-target`)は
 * 「違反 0 件」で緑になる。土台の壊れ方は利用側のテスト名からは読み取れないため、
 * ここで直接押さえる。
 */
describe('CSS のルール分解', () => {
  it('セレクタと宣言の組に分ける', () => {
    expect(cssRules('.a {\n  color: red;\n}\n.b {\n  gap: 0;\n}')).toEqual([
      { selector: '.a', body: '\n  color: red;\n' },
      { selector: '.b', body: '\n  gap: 0;\n' },
    ])
  })

  it('@media の入れ子は内側のルールが取れる', () => {
    const rules = cssRules('@media (max-width: 320px) {\n  .a {\n    width: 12px;\n  }\n}')
    expect(rules.map(({ selector }) => selector)).toEqual(['.a'])
    expect(rules[0]?.body).toContain('width: 12px')
  })

  it('末尾のセミコロンが無い宣言も本文に含む', () => {
    expect(cssRules('.a {\n  width: 20px\n}')[0]?.body).toContain('width: 20px')
  })

  it('コメントを落としてからセレクタを読む', () => {
    // コメント内の語をセレクタと誤読すると、本文中の記述が違反として報告される
    const rules = cssRules('/* .fake { width: 44px } */\n.real {\n  width: 44px;\n}')
    expect(rules.map(({ selector }) => selector)).toEqual(['.real'])
  })

  it('複数行コメントを丸ごと落とす', () => {
    expect(stripComments('/**\n * 説明\n */\n.a {}').trim()).toBe('.a {}')
  })
})
