import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LoadingState } from '../LoadingState'

const SRC_DIR = join(import.meta.dirname, '../../..')

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })
}

describe('LoadingState', () => {
  it('既定では「読み込み中...」を表示する', () => {
    render(<LoadingState />)

    expect(screen.getByText('読み込み中...')).toBeInTheDocument()
  })

  it('何を読み込んでいるかを指定できる', () => {
    render(<LoadingState>分類の選択肢を読み込み中...</LoadingState>)

    expect(screen.getByText('分類の選択肢を読み込み中...')).toBeInTheDocument()
    expect(screen.queryByText('読み込み中...')).not.toBeInTheDocument()
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
    const stylesheets = walk(SRC_DIR).filter(path => path.endsWith('.module.css'))
    const offenders = stylesheets
      .filter(path => !path.endsWith('LoadingState.module.css'))
      .filter(path => /^\.loading\b/m.test(readFileSync(path, 'utf8')))

    // 走査自体が空振りしていないことを併せて確認する
    expect(stylesheets.length).toBeGreaterThan(0)
    expect(offenders).toEqual([])
  })
})
