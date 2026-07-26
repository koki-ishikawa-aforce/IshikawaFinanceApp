import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EmptyState } from '../EmptyState'

const SRC_DIR = join(import.meta.dirname, '../../..')

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })
}

describe('EmptyState', () => {
  it('案内文をそのまま表示する', () => {
    render(<EmptyState>この条件の取引はありません</EmptyState>)

    expect(screen.getByText('この条件の取引はありません')).toBeInTheDocument()
  })

  it('データ有無の切り替わりが読み上げられるよう role="status" で通知する', () => {
    render(<EmptyState>登録されている口座がありません</EmptyState>)

    // 月やモードの切り替えは画面遷移を伴わないため、これが無いと切り替わりが伝わらない
    expect(screen.getByRole('status')).toHaveTextContent('登録されている口座がありません')
  })

  it('要素を含む案内文も表示できる', () => {
    render(
      <EmptyState>
        この月のレポートはまだ作成されていません。
        <br />
        CSV 取込の完了後に作成されます。
      </EmptyState>,
    )

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('この月のレポートはまだ作成されていません。')
    expect(status).toHaveTextContent('CSV 取込の完了後に作成されます。')
  })

  it('announce={false} のときは live region にしない', () => {
    // モーダル内の固定メッセージなど、開いた時点から切り替わらない場所での二重読み上げを避ける
    render(
      <EmptyState announce={false}>
        配偶者の個人取引のため、詳細の閲覧・編集はできません
      </EmptyState>,
    )

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(
      screen.getByText('配偶者の個人取引のため、詳細の閲覧・編集はできません'),
    ).toBeInTheDocument()
  })

  it('空状態専用のカード・イラストを持たず、インラインのテキストだけを描画する', () => {
    // usability 6-6: 空状態はインラインのテキスト。器(カード / モーダル)は呼び出し側が持つ
    const { container } = render(<EmptyState>世帯支出はありません</EmptyState>)

    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
  })
})

describe('空状態スタイルの重複定義の禁止', () => {
  // 検出できるのは「`.empty` という名前で CSS に書かれた重複」だけ。別名クラスで
  // 空状態を書き起こす迂回は検出できないため、集約そのものの担保は各画面のテストで行う
  it('EmptyState 以外の .module.css に .empty が定義されていない', () => {
    const stylesheets = walk(SRC_DIR).filter(path => path.endsWith('.module.css'))
    const offenders = stylesheets
      .filter(path => !path.endsWith('EmptyState.module.css'))
      .filter(path => /^\.empty\b/m.test(readFileSync(path, 'utf8')))

    // 走査自体が空振りしていないことを併せて確認する
    expect(stylesheets.length).toBeGreaterThan(0)
    expect(offenders).toEqual([])
  })
})
