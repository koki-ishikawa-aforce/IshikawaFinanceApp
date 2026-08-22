import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ErrorState } from '../ErrorState'

const SRC_DIR = join(import.meta.dirname, '../../..')

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })
}

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
    const stylesheets = walk(SRC_DIR).filter(path => path.endsWith('.module.css'))
    const offenders = stylesheets
      .filter(path => !path.endsWith('ErrorState.module.css'))
      .filter(path => /^\.error\b/m.test(readFileSync(path, 'utf8')))

    // 走査自体が空振りしていないことを併せて確認する
    expect(stylesheets.length).toBeGreaterThan(0)
    expect(offenders).toEqual([])
  })
})
