import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RestrictedState } from '../RestrictedState'
import { cssRules } from '@/test/css-rules'
import { SRC_DIR } from '@/test/sources'
import { definesClass, findDuplicateClassDefinitions, listStylesheets } from '@/test/stylesheets'

const MESSAGE = 'パートナーの個人取引のため、詳細の閲覧・編集はできません'

describe('RestrictedState', () => {
  it('なぜ見えないのかを伝える文言をそのまま表示する', () => {
    render(<RestrictedState>{MESSAGE}</RestrictedState>)

    expect(screen.getByText(MESSAGE)).toBeInTheDocument()
  })

  it('見せない対象の切り替わりが読み上げられるよう role="status" で通知する', () => {
    // Modal は開いてもフォーカスを内側へ移さない(usability §9 #10)ため、
    // ここを落とすと伏せている旨が読み上げ利用者に一度も伝わらない
    render(<RestrictedState>{MESSAGE}</RestrictedState>)

    expect(screen.getByRole('status')).toHaveTextContent(MESSAGE)
  })

  it('announce={false} のときは live region にしない', () => {
    // 別経路で確実に読み上げられる場所での二重読み上げを避けるための逃げ道
    render(<RestrictedState announce={false}>{MESSAGE}</RestrictedState>)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText(MESSAGE)).toBeInTheDocument()
  })

  it.each([[null], [undefined], ['']])('文言が %s のときは何も描画しない', children => {
    // 錠前と面だけが残ると、何が見えないのか伝わらないまま
    // 「見えないものがある」ことだけを示すことになる
    const { container } = render(<RestrictedState>{children}</RestrictedState>)

    expect(container).toBeEmptyDOMElement()
  })

  it('錠前のアイコンは装飾として扱い、読み上げの文言に混ぜない', () => {
    // DESIGN.md §6: テキストで意味が伝わるアイコンは aria-hidden
    const { container } = render(<RestrictedState>{MESSAGE}</RestrictedState>)

    const icon = container.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('status')).toHaveTextContent(MESSAGE)
  })
})

/**
 * 「データが無い」との見分けが付くことが、この部品を空状態と分けた理由そのもの
 * (`docs/design/usability.md` 2-2)。同じ見た目に寄せ直されると、部品名だけ分かれて
 * 意図が消えるため、区別の実体(アクセントの面を持つ / 空状態は持たない)を対で固定する。
 */
describe('空状態と見た目が分かれていること', () => {
  function ruleOf(cssPath: string, className: string): string {
    const content = readFileSync(join(SRC_DIR, cssPath), 'utf8')
    const rule = cssRules(content).find(({ selector }) => selector === `.${className}`)
    return (rule?.body ?? '').replace(/\s+/g, ' ').trim()
  }

  const RESTRICTED_CSS = join('components', 'ui', 'RestrictedState.module.css')
  const EMPTY_CSS = join('components', 'ui', 'EmptyState.module.css')

  it('伏せていることが分かるテーマ色の面と角丸を持つ', () => {
    const restricted = ruleOf(RESTRICTED_CSS, 'restricted')

    // --surface-accent-soft は --accent をごく薄く敷いた面(globals.css)
    expect(restricted).toContain('background: var(--surface-accent-soft)')
    expect(restricted).toContain('border-radius:')
  })

  it('空状態の .empty は面を持たない(区別が面の有無で付く)', () => {
    const empty = ruleOf(EMPTY_CSS, 'empty')

    expect(empty.length).toBeGreaterThan(0)
    expect(empty).not.toContain('background')
    expect(empty).not.toContain('border-radius')
  })

  it('本文相当の濃さで出す(淡い面の上で 4.5:1 を割らないため)', () => {
    const restricted = ruleOf(RESTRICTED_CSS, 'restricted')

    // --text-secondary(補足文の色)へ戻すと両テーマとも 4.5:1 を下回る
    expect(restricted).toContain('color: var(--text-primary)')
  })

  it('錠前の大きさの基準を面の側に持つ(文言と連動させる)', () => {
    // --icon-sm は 1em。基準を書かないと祖先(ブラウザ既定 16px)に委ねられ、
    // 12px の文言の隣に 16px の錠前が並ぶ
    const restricted = ruleOf(RESTRICTED_CSS, 'restricted')

    expect(restricted).toContain('font-size: var(--text-sm)')
  })
})

describe('プライバシー表示スタイルの重複定義の禁止', () => {
  // 検出できるのは「`.restricted` という名前で CSS に書かれた重複」だけ。別名クラスで
  // 書き起こす迂回は検出できないため、集約そのものの担保は各画面のテストで行う
  it('RestrictedState 以外の .module.css に .restricted が定義されていない', () => {
    // 走査自体が空振りしていないこと・正本が実際に定義していることを併せて確認する
    expect(listStylesheets().length).toBeGreaterThan(0)
    expect(definesClass('restricted', 'RestrictedState.module.css')).toBe(true)
    expect(findDuplicateClassDefinitions('restricted', 'RestrictedState.module.css')).toEqual([])
  })
})
