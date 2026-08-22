import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ErrorState } from '../ErrorState'
import { definesClass, findDuplicateClassDefinitions, listStylesheets } from '@/test/stylesheets'

describe('ErrorState', () => {
  it('失敗の文言をそのまま表示する', () => {
    render(<ErrorState>レポートの取得に失敗しました</ErrorState>)

    expect(screen.getByText('レポートの取得に失敗しました')).toBeInTheDocument()
  })

  it('失敗に気づけるよう role="alert" で通知する', () => {
    render(<ErrorState>カテゴリ内訳の取得に失敗しました</ErrorState>)

    // 月やモードの切り替えは画面遷移を伴わないため、これが無いと取得の失敗に気づけない
    expect(screen.getByRole('alert')).toHaveTextContent('カテゴリ内訳の取得に失敗しました')
  })

  it('要素を含む文言も表示できる', () => {
    render(
      <ErrorState>
        保存できませんでした。
        <span>時間をおいて、もう一度お試しください。</span>
      </ErrorState>,
    )

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('保存できませんでした。')
    expect(alert).toHaveTextContent('時間をおいて、もう一度お試しください。')
  })

  it('文言が空なら何も描画しない', () => {
    // API のエラーメッセージが空文字でも、無音の live region と赤い余白だけが残らないようにする
    const { container } = render(<ErrorState>{''}</ErrorState>)

    expect(container).toBeEmptyDOMElement()
  })

  it('アイコンなどの図形を持たず、インラインのテキストだけを描画する', () => {
    const { container } = render(<ErrorState>保存できませんでした</ErrorState>)

    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
  })

  it('announce={false} のときは live region にしない', () => {
    // 呼び出し側が常時マウントの live region を持つ場合、入れ子にすると二重に読まれる
    render(<ErrorState announce={false}>残高一覧の取得に失敗しました</ErrorState>)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('残高一覧の取得に失敗しました')).toBeInTheDocument()
  })
})

describe('エラースタイルの重複定義の禁止', () => {
  // 検出できるのは「`.error` という名前で CSS に書かれた重複」だけ。別名クラスで
  // エラー表示を書き起こす迂回は検出できないため、集約そのものの担保は各画面のテストで行う
  it('ErrorState 以外の .module.css に .error が定義されていない', () => {
    const offenders = findDuplicateClassDefinitions('error', 'ErrorState.module.css')

    // 走査自体が空振りしていないこと・正本が実際に定義していることを併せて確認する
    expect(listStylesheets().length).toBeGreaterThan(0)
    expect(definesClass('error', 'ErrorState.module.css')).toBe(true)
    expect(offenders).toEqual([])
  })
})
