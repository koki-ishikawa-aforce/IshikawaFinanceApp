import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SRC_DIR, collectSources, isModuleCss, isTsx, type Source } from './sources'

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
 * 2. JSX で大きさを直接指定しない(`size` / `width` / `height` / インラインスタイル)
 * 3. アイコンに当てている CSS クラスに width / height の直値を書かない
 *
 * 前提: 共通クラスは `common.module.css` を `ui` という別名で import して参照する
 * (`ui.iconSm` 等)。別名を変えるとこのガードは違反として報告する。
 */

/**
 * アイコン部品の名前。`Lu*` は react-icons、`RoleIcon` はロール識別アイコン、
 * `Icon` は部品を変数で受け取る呼び出し(`AppNav` のナビ項目・`RoleIcon` の中継)。
 */
const ICON_NAME = /<(Lu[A-Z][A-Za-z0-9]*|RoleIcon|Icon)(?=[\s/>])/g

/** 大きさを与える共通クラス(`components/ui/common.module.css`) */
const SIZE_CLASS = /\bui\.(iconSm|iconMd|iconLg|iconInline)\b/

/** JSX から大きさを直接指定する書き方。クラスと二重に大きさを決めさせない */
const DIRECT_SIZE_PROP = /\b(?:size|width|height)=/
const DIRECT_SIZE_STYLE = /style=\{\{[^}]*\b(?:width|height|fontSize)\b/

/**
 * RoleIcon 自身は呼び出し元から className を受け取って中継するだけで、
 * 大きさを決めるのは呼び出し元。ここだけは共通クラスが現れない。
 */
const SIZE_CLASS_EXEMPT = [join('components', 'ui', 'RoleIcon.tsx')]

interface IconElement {
  readonly name: string
  /** 開始タグの属性部分。文字列・入れ子の波括弧・アロー関数を含みうる */
  readonly props: string
}

/**
 * アイコンの開始タグを取り出す。
 *
 * 正規表現で `<Lu... />` をまとめて取ると、属性にアロー関数(`onClick={() => …}`)や
 * 比較演算子が入った要素を**黙って走査から落とす**。落ちたことに気づけないのが
 * ガードとして最悪なので、名前の出現ごとに引用符と波括弧の深さを見ながら
 * タグの終わりまで読む。
 */
function iconElements(content: string): IconElement[] {
  return [...content.matchAll(ICON_NAME)].map(match => {
    const start = (match.index ?? 0) + match[0].length
    let depth = 0
    let quote: string | null = null
    let end = start
    for (; end < content.length; end++) {
      const char = content[end]
      if (quote !== null) {
        if (char === quote) quote = null
        continue
      }
      if (char === '"' || char === "'" || char === '`') quote = char
      else if (char === '{') depth++
      else if (char === '}') depth--
      else if (char === '>' && depth === 0) break
    }
    return { name: match[1] ?? '', props: content.slice(start, end) }
  })
}

/** 共通クラスで大きさを指定していないアイコンを返す(`ファイル:部品名` 形式) */
function findUnsizedIcons(sources: readonly Source[]): string[] {
  return sources.flatMap(({ path, content }) =>
    SIZE_CLASS_EXEMPT.includes(path)
      ? []
      : iconElements(content)
          .filter(({ props }) => !SIZE_CLASS.test(props))
          .map(({ name }) => `${path}:${name}`),
  )
}

/** JSX から大きさを直接指定しているアイコンを返す */
function findDirectSizes(sources: readonly Source[]): string[] {
  return sources.flatMap(({ path, content }) =>
    iconElements(content)
      .filter(({ props }) => DIRECT_SIZE_PROP.test(props) || DIRECT_SIZE_STYLE.test(props))
      .map(({ name }) => `${path}:${name}`),
  )
}

/** アイコンに当てている CSS モジュールのクラス名(`styles.chevron` の `chevron`)を集める */
function iconClassNames(sources: readonly Source[]): Set<string> {
  const names = new Set<string>()
  for (const { content } of sources) {
    for (const { props } of iconElements(content)) {
      for (const reference of props.matchAll(/\b[A-Za-z_$][\w$]*\.([A-Za-z_$][\w$]*)\b/g)) {
        const name = reference[1] ?? ''
        if (!/^icon(Sm|Md|Lg|Inline)$/.test(name)) names.add(name)
      }
    }
  }
  return names
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

/**
 * width / height の宣言。`line-height` や `min-width` に巻き込まれないよう
 * 直前が単語・ハイフンでないことを確かめる。末尾の `;` は省略されうる。
 */
const SIZE_DECLARATION = /(?:^|[;{\s])(?:width|height)\s*:\s*([^;}]+)/g

/**
 * アイコンに当てているクラスに width / height の直値を書いている箇所を返す。
 *
 * 対象セレクタは JSX 側で実際にアイコンへ当てているクラス名から決める。
 * 名前に icon を含むかどうかで決めると、`.chevron` のような命名を取りこぼす。
 */
function findHardcodedIconSizes(
  stylesheets: readonly Source[],
  classNames: ReadonlySet<string>,
): string[] {
  return stylesheets.flatMap(({ path, content }) =>
    cssRules(content)
      .filter(({ selector, body }) => {
        const targeted =
          /icon/i.test(selector) ||
          [...selector.matchAll(/\.([A-Za-z_-][\w-]*)/g)].some(match =>
            classNames.has(match[1] ?? ''),
          )
        if (!targeted) return false
        return [...body.matchAll(SIZE_DECLARATION)].some(
          match => !(match[1] ?? '').includes('var(--'),
        )
      })
      .map(({ selector }) => `${path}:${selector}`),
  )
}

describe('アイコンの大きさ', () => {
  const sources = collectSources(isTsx)
  const stylesheets = collectSources(isModuleCss)

  it('すべてのアイコンが共通クラスで大きさを指定している', () => {
    expect(findUnsizedIcons(sources)).toEqual([])
  })

  it('JSX から大きさを直接指定していない', () => {
    expect(findDirectSizes(sources)).toEqual([])
  })

  it('アイコンに当てているクラスに width / height の直値が無い', () => {
    expect(findHardcodedIconSizes(stylesheets, iconClassNames(sources))).toEqual([])
  })

  it('大きさのスケールが globals.css の 1 か所に定義されている', () => {
    const globals = readFileSync(join(SRC_DIR, 'app', 'globals.css'), 'utf8')
    expect(globals).toMatch(/--icon-sm:\s*1em;/)
    expect(globals).toMatch(/--icon-md:\s*1\.25em;/)
    expect(globals).toMatch(/--icon-lg:\s*1\.5em;/)
    // 画面側で再定義すると「1 か所」でなくなる
    expect(stylesheets.filter(({ content }) => /--icon-[a-z]+\s*:/.test(content))).toEqual([])
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

  it('アイコンを置いている画面から実際にアイコンを検出できている', () => {
    // 走査がファイルを読めていても要素を取れていなければ、上のテストは空のまま緑になる。
    // 変数経由の呼び出し(AppNav の <Icon />)を取りこぼした実績があるため件数で固定する。
    const detected = new Map(
      sources.map(({ path, content }) => [path, iconElements(content).length]),
    )
    expect(detected.get(join('components', 'ui', 'AppNav.tsx'))).toBe(1)
    expect(detected.get(join('components', 'ui', 'RoleIcon.tsx'))).toBe(1)
    expect(detected.get(join('components', 'dashboard', 'MonthNavigator.tsx'))).toBe(2)
    expect(detected.get(join('app', 'balances', 'page.tsx'))).toBe(4)
    // #497 でエラー表示を共通部品 ErrorState に寄せ、警告アイコン(LuTriangleAlert)付きの
    // 独自表示が 1 つ減った後の件数
    expect(detected.get(join('app', 'onboarding', 'page.tsx'))).toBe(13)

    expect(stylesheets.map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        join('components', 'ui', 'common.module.css'),
        join('components', 'ui', 'AppNav.module.css'),
        join('app', 'balances', 'page.module.css'),
      ]),
    )
  })

  it('実在する書き方を違反と誤判定しない', () => {
    const valid: Source[] = [
      {
        path: 'valid.tsx',
        content: [
          '<LuX\n  aria-hidden="true"\n  className={ui.iconSm}\n/>',
          '<LuChevronDown className={`${ui.iconSm} ${expanded ? s.chevronOpen : s.chevron}`} />',
          '<LuBell aria-hidden="true" className={ui.iconSm} onClick={() => setOpen(true)} />',
          '<LuRocket aria-hidden="true" className={ui.iconInline} style={{ verticalAlign: \'middle\' }} />',
        ].join('\n'),
      },
    ]
    expect(findUnsizedIcons(valid)).toEqual([])
    expect(findDirectSizes(valid)).toEqual([])
    expect(iconClassNames(valid)).toEqual(new Set(['chevronOpen', 'chevron']))
  })

  it('違反を検出できる', () => {
    // 検出ロジック自体が壊れると全件 0 件で緑になるため、既知の違反例で固定する
    const offending: Source[] = [
      {
        path: 'offender.tsx',
        content: [
          '<LuX aria-hidden="true" />',
          '<Icon className={styles.navIcon} aria-hidden="true" />',
          '<LuPlus aria-hidden="true" size="1.5em" className={ui.iconLg} />',
          '<LuBell className={ui.iconSm} style={{ width: 18 }} />',
          '<LuCheck className={`${ui.iconSm} ${styles.chevron}`} onClick={() => close()} />',
        ].join('\n'),
      },
    ]
    expect(findUnsizedIcons(offending)).toEqual(['offender.tsx:LuX', 'offender.tsx:Icon'])
    expect(findDirectSizes(offending)).toEqual(['offender.tsx:LuPlus', 'offender.tsx:LuBell'])

    // アイコンに当てているクラスは、名前に icon を含まなくても検査対象になる
    const offendingStyles: Source[] = [
      {
        path: 'offender.module.css',
        content: [
          '.chevron {\n  width: 18px;\n  height: 18px;\n}',
          '.someIcon {\n  width: 20px\n}',
          '.unrelated {\n  width: 100%;\n  line-height: 1;\n}',
          '@media (max-width: 320px) {\n  .navIcon {\n    width: 12px;\n  }\n}',
        ].join('\n'),
      },
    ]
    expect(findHardcodedIconSizes(offendingStyles, iconClassNames(offending))).toEqual([
      'offender.module.css:.chevron',
      'offender.module.css:.someIcon',
      'offender.module.css:.navIcon',
    ])
  })
})
