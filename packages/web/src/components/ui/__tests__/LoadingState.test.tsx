import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LoadingState } from '../LoadingState'
import { definesClass, findDuplicateClassDefinitions, listStylesheets } from '@/test/stylesheets'

describe('LoadingState', () => {
  it('既定では「読み込み中...」を表示する', () => {
    render(<LoadingState />)

    expect(screen.getByText('読み込み中...')).toBeInTheDocument()
  })

  it('何を読み込んでいるかを指定でき、既定の文言は出ない', () => {
    render(<LoadingState>分類の選択肢を読み込み中...</LoadingState>)

    // 既定文言との連結(「分類の選択肢を読み込み中...読み込み中...」)を弾くため全文で固定する
    expect(screen.getByRole('status')).toHaveTextContent(/^分類の選択肢を読み込み中\.\.\.$/)
  })

  it('文言が空なら何も描画しない', () => {
    // 無音の live region と余白だけが残るのを避ける
    const { container } = render(<LoadingState>{''}</LoadingState>)

    expect(container).toBeEmptyDOMElement()
  })

  it('スピナーなどの図形を持たず、インラインのテキストだけを描画する', () => {
    const { container } = render(<LoadingState />)

    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
  })

  it('取得中への切り替わりが読み上げられるよう role="status" で通知する', () => {
    render(<LoadingState />)

    // 月やモードの切り替えは画面遷移を伴わないため、これが無いと取得中が伝わらない
    expect(screen.getByRole('status')).toHaveTextContent('読み込み中...')
  })

  it('announce={false} のときは live region にしない', () => {
    // 呼び出し側が常時マウントの live region を持つ場合、入れ子にすると二重に読まれる
    render(<LoadingState announce={false} />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText('読み込み中...')).toBeInTheDocument()
  })
})

describe('ローディングスタイルの重複定義の禁止', () => {
  // 検出できるのは「`.loading` という名前で CSS に書かれた重複」だけ。別名クラスで
  // ローディングを書き起こす迂回は検出できないため、集約そのものの担保は各画面のテストで行う
  it('LoadingState 以外の .module.css に .loading が定義されていない', () => {
    const offenders = findDuplicateClassDefinitions('loading', 'LoadingState.module.css')

    // 走査自体が空振りしていないこと・正本が実際に定義していることを併せて確認する
    expect(listStylesheets().length).toBeGreaterThan(0)
    expect(definesClass('loading', 'LoadingState.module.css')).toBe(true)
    expect(offenders).toEqual([])
  })
})
