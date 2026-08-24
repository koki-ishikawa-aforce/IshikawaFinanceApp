import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RestrictedState } from '../RestrictedState'
import { cssRules } from '@/test/css-rules'
import { SRC_DIR } from '@/test/sources'
import { definesClass, findDuplicateClassDefinitions, listStylesheets } from '@/test/stylesheets'

describe('RestrictedState', () => {
  it('なぜ見えないのかを伝える文言をそのまま表示する', () => {
    render(<RestrictedState>配偶者の個人取引のため、詳細の閲覧・編集はできません</RestrictedState>)

    expect(
      screen.getByText('配偶者の個人取引のため、詳細の閲覧・編集はできません'),
    ).toBeInTheDocument()
  })

  it('見せない対象の切り替わりが読み上げられるよう role="status" で通知する', () => {
    render(<RestrictedState>配偶者の個人取引のため、詳細の閲覧・編集はできません</RestrictedState>)

    expect(screen.getByRole('status')).toHaveTextContent(
      '配偶者の個人取引のため、詳細の閲覧・編集はできません',
    )
  })

  it('announce={false} のときは live region にしない', () => {
    // モーダルを開いた時点で確定している場所での二重読み上げを避ける
    render(
      <RestrictedState announce={false}>
        配偶者の個人取引のため、詳細の閲覧・編集はできません
      </RestrictedState>,
    )

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(
      screen.getByText('配偶者の個人取引のため、詳細の閲覧・編集はできません'),
    ).toBeInTheDocument()
  })

  it('文言が空のときは何も描画しない', () => {
    // 錠前と面だけが残ると、何が見えないのか伝わらないまま
    // 「見えないものがある」ことだけを示すことになる
    const { container } = render(<RestrictedState>{''}</RestrictedState>)

    expect(container).toBeEmptyDOMElement()
  })

  it('錠前のアイコンは装飾として扱い、読み上げの文言に混ぜない', () => {
    // DESIGN.md §6: テキストで意味が伝わるアイコンは aria-hidden
    const { container } = render(
      <RestrictedState>配偶者の個人取引のため、詳細の閲覧・編集はできません</RestrictedState>,
    )

    const icon = container.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('status')).toHaveTextContent(
      '配偶者の個人取引のため、詳細の閲覧・編集はできません',
    )
  })
})

/**
 * 「データが無い」との見分けが付くことが、この部品を空状態と分けた理由そのもの
 * (`docs/design/usability.md` 2-2)。同じ見た目に寄せ直されると、部品名だけ分かれて
 * 意図が消えるため、面を持つことと空状態と宣言が違うことを固定する。
 */
describe('空状態と見た目が分かれていること', () => {
  function ruleOf(cssPath: string, className: string): string {
    const content = readFileSync(join(SRC_DIR, cssPath), 'utf8')
    const rule = cssRules(content).find(({ selector }) => selector === `.${className}`)
    return (rule?.body ?? '').replace(/\s+/g, ' ').trim()
  }

  const RESTRICTED_CSS = join('components', 'ui', 'RestrictedState.module.css')
  const EMPTY_CSS = join('components', 'ui', 'EmptyState.module.css')

  it('伏せていることが分かる面(背景と角丸)を持つ', () => {
    const restricted = ruleOf(RESTRICTED_CSS, 'restricted')

    expect(restricted).toContain('background:')
    expect(restricted).toContain('border-radius:')
  })

  it('空状態の .empty と同じ宣言に戻っていない', () => {
    const restricted = ruleOf(RESTRICTED_CSS, 'restricted')
    const empty = ruleOf(EMPTY_CSS, 'empty')

    expect(restricted.length).toBeGreaterThan(0)
    expect(empty.length).toBeGreaterThan(0)
    expect(restricted).not.toBe(empty)
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
