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

  it('空状態専用のカード・イラストを持たず、インラインのテキストだけを描画する', () => {
    // usability 6-6: 空状態はインラインのテキスト。器(カード / モーダル)は呼び出し側が持つ
    const { container } = render(<EmptyState>世帯支出はありません</EmptyState>)

    expect(container.childElementCount).toBe(1)
    expect(container.firstElementChild?.tagName).toBe('DIV')
    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
  })
})

describe('空状態の共通部品への集約', () => {
  it('共通スタイルシートに .empty が残っていない（部品を迂回できない）', () => {
    const css = readFileSync(join(SRC_DIR, 'components/ui/common.module.css'), 'utf8')

    expect(css).not.toMatch(/^\.empty\b/m)
  })

  it('EmptyState 以外に空状態のスタイルを持つ .module.css が無い', () => {
    const offenders = walk(SRC_DIR)
      .filter(path => path.endsWith('.module.css') && !path.endsWith('EmptyState.module.css'))
      .filter(path => /^\.empty\b/m.test(readFileSync(path, 'utf8')))

    expect(offenders).toEqual([])
  })
})
