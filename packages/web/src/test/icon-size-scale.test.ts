import { readFileSync, readdirSync } from 'node:fs'
import { join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * アイコンの大きさをスケール(DESIGN.md §4)に閉じ込めるリグレッションガード(#424)。
 *
 * 大きさの指定手段が 2 通り(JSX の `size` プロパティ / `*.module.css` の width・height)
 * あったため、画面ごとに 1em・1.25em・1.5em・18px・14px が混在していた。
 * 色・余白・角丸・フォントサイズは stylelint がトークン利用を機械的に強制しているが、
 * width / height はレイアウト用途(`width: 100%` 等)と区別できないため stylelint では
 * 縛れない。そこでアイコンに限ってここで縛る。
 *
 * 守らせるのは次の 3 つ:
 * 1. アイコンには共通クラス(`.iconSm` / `.iconMd` / `.iconLg`)が付いている
 * 2. JSX で `size` プロパティを使わない(クラスと二重に大きさを決めさせない)
 * 3. アイコン用の CSS クラスに width / height の直値を書かない
 */

/** vitest の root は packages/web なので、そこからの相対で src を辿る */
const SRC_DIR = join(process.cwd(), 'src')

interface Source {
  /** src からの相対パス。違反の報告に使う */
  readonly path: string
  readonly content: string
}

/** アイコン部品の呼び出し。`Lu*` は react-icons、`RoleIcon` はロール識別アイコン */
const ICON_ELEMENT = /<(Lu[A-Z][A-Za-z0-9]*|RoleIcon)\s([^>]*?)\/>/gs

/** 大きさを与える共通クラス(`components/ui/common.module.css`) */
const SIZE_CLASS = /\bui\.(iconSm|iconMd|iconLg)\b/

/**
 * RoleIcon 自身は呼び出し元から className を受け取って中継するだけで、
 * 大きさを決めるのは呼び出し元。ここだけは共通クラスが現れない。
 */
const SIZE_CLASS_EXEMPT = [join('components', 'ui', 'RoleIcon.tsx')]

function collectSources(dir: string, match: (name: string) => boolean): Source[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      // __tests__ とこのガード自身の置き場は、違反例を検証データとして持ちうるので除外する
      return entry.name === '__tests__' || entry.name === 'test' ? [] : collectSources(path, match)
    }
    if (!entry.isFile() || !match(entry.name)) return []
    return [{ path: path.slice(SRC_DIR.length + sep.length), content: readFileSync(path, 'utf8') }]
  })
}

/** 共通クラスで大きさを指定していないアイコンを返す(`ファイル:部品名` 形式) */
function findUnsizedIcons(sources: readonly Source[]): string[] {
  return sources.flatMap(({ path, content }) => {
    if (SIZE_CLASS_EXEMPT.includes(path)) return []
    return [...content.matchAll(ICON_ELEMENT)]
      .filter(match => !SIZE_CLASS.test(match[2] ?? ''))
      .map(match => `${path}:${match[1]}`)
  })
}

/** JSX の size プロパティで大きさを指定しているアイコンを返す */
function findSizeProps(sources: readonly Source[]): string[] {
  return sources.flatMap(({ path, content }) =>
    [...content.matchAll(ICON_ELEMENT)]
      .filter(match => /\bsize=/.test(match[2] ?? ''))
      .map(match => `${path}:${match[1]}`),
  )
}

/** CSS のルール(セレクタと宣言の組)。@media の入れ子は内側のルールが取れる */
const CSS_RULE = /([^{}]+)\{([^{}]*)\}/g

/** コメントはセレクタの手前に現れ、そのまま読むと本文の語をセレクタと誤認するため落とす */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

function cssRules(css: string): { selector: string; body: string }[] {
  return [...stripComments(css).matchAll(CSS_RULE)].map(match => ({
    selector: (match[1] ?? '').trim(),
    body: match[2] ?? '',
  }))
}

/** アイコン用クラスに width / height の直値を書いている箇所を返す */
function findHardcodedIconSizes(stylesheets: readonly Source[]): string[] {
  return stylesheets.flatMap(({ path, content }) =>
    cssRules(content)
      .filter(
        ({ selector, body }) =>
          /icon/i.test(selector) &&
          [...body.matchAll(/\b(?:width|height)\s*:\s*([^;]+);/g)].some(
            match => !(match[1] ?? '').includes('var(--'),
          ),
      )
      .map(({ selector }) => `${path}:${selector}`),
  )
}

describe('アイコンの大きさ', () => {
  const sources = collectSources(SRC_DIR, name => name.endsWith('.tsx'))
  const stylesheets = collectSources(SRC_DIR, name => name.endsWith('.module.css'))

  it('すべてのアイコンが共通クラスで大きさを指定している', () => {
    expect(findUnsizedIcons(sources)).toEqual([])
  })

  it('JSX の size プロパティで大きさを指定していない', () => {
    expect(findSizeProps(sources)).toEqual([])
  })

  it('アイコン用の CSS クラスに width / height の直値が無い', () => {
    expect(findHardcodedIconSizes(stylesheets)).toEqual([])
  })

  it('大きさのスケールが globals.css の 1 か所に定義されている', () => {
    const globals = readFileSync(join(SRC_DIR, 'app', 'globals.css'), 'utf8')
    expect(globals).toMatch(/--icon-sm:\s*1em;/)
    expect(globals).toMatch(/--icon-md:\s*[\d.]+em;/)
    expect(globals).toMatch(/--icon-lg:\s*[\d.]+em;/)
  })

  it('共通クラスがスケールのトークンだけを参照している', () => {
    const common = stylesheets.find(
      ({ path }) => path === join('components', 'ui', 'common.module.css'),
    )
    const sizeClasses = cssRules(common?.content ?? '').filter(({ selector }) =>
      /^\.icon(Sm|Md|Lg)$/.test(selector),
    )
    expect(sizeClasses.map(({ selector }) => selector)).toEqual(['.iconSm', '.iconMd', '.iconLg'])
    for (const { selector, body } of sizeClasses) {
      const token = `var(--icon-${selector.replace('.icon', '').toLowerCase()})`
      expect(body).toContain(`width: ${token};`)
      expect(body).toContain(`height: ${token};`)
    }
  })

  it('アイコンを置いている画面のソースを走査対象に含めている', () => {
    // 走査が対象を取りこぼしていると、上のテストは中身が空のまま緑になる
    expect(sources.map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        join('app', 'onboarding', 'page.tsx'),
        join('app', 'balances', 'page.tsx'),
        join('app', 'settings', 'page.tsx'),
        join('components', 'dashboard', 'MonthNavigator.tsx'),
        join('components', 'ui', 'AppNav.tsx'),
      ]),
    )
    expect(stylesheets.map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        join('components', 'ui', 'common.module.css'),
        join('components', 'ui', 'AppNav.module.css'),
        join('app', 'balances', 'page.module.css'),
      ]),
    )
  })

  it('違反を検出できる', () => {
    // 検出ロジック自体が壊れると全件 0 件で緑になるため、既知の違反例で固定する
    const offending: Source[] = [
      {
        path: 'offender.tsx',
        content: [
          '<LuX aria-hidden="true" />',
          '<LuPlus aria-hidden="true" size="1.5em" className={ui.iconLg} />',
          '<LuBell aria-hidden="true" className={ui.iconSm} />',
        ].join('\n'),
      },
    ]
    expect(findUnsizedIcons(offending)).toEqual(['offender.tsx:LuX'])
    expect(findSizeProps(offending)).toEqual(['offender.tsx:LuPlus'])
    expect(
      findHardcodedIconSizes([
        {
          path: 'offender.module.css',
          content: '.someIcon {\n  width: 18px;\n  height: 18px;\n}\n.other {\n  width: 100%;\n}',
        },
      ]),
    ).toEqual(['offender.module.css:.someIcon'])
  })
})
