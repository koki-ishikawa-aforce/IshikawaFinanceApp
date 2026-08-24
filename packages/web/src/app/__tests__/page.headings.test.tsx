/**
 * ダッシュボードの見出し階層(`docs/design/usability.md` 8-5)を固定する。
 *
 * この画面はタイトルの文字を出す場所が無く、見出しが 1 つも無いまま
 * 「見た目だけ見出しに見える `<span>`」でセクションを区切っていた。
 * 見出しは押しても何も起きないため、壊れても画面を見ているだけでは気づけない。
 *
 * 取得失敗からの再試行の結線は page.test.tsx が担当する。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { cssRules } from '@/test/css-rules'
import { SRC_DIR } from '@/test/sources'
import DashboardPage from '../page'

// 見出しは取得状態によらず出る。応答は返さず、描画だけを見る
vi.mock('@/lib/api-client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>()
  return { ...actual, apiFetch: vi.fn(() => new Promise(() => {})) }
})

function renderDashboard(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <DashboardPage />
    </QueryClientProvider>,
  )
}

describe('ダッシュボードの見出し', () => {
  it('画面名の見出し(h1)を 1 つ持つ', () => {
    renderDashboard()

    // 文言は下部ナビの項目名と揃える(同 5-1)。利用者が目にしない「ダッシュボード」は使わない
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('ホーム')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('カテゴリ内訳のセクション見出しが h2 として扱われる', () => {
    renderDashboard()

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('世帯支出（カテゴリ別）')
  })

  it('見出しの階層を飛ばさない(h1 の次が h2)', () => {
    renderDashboard()

    const levels = screen
      .getAllByRole('heading')
      .map(heading => Number(heading.tagName.slice(1)))
      .sort((a, b) => a - b)

    expect(levels[0]).toBe(1)
    // 隣り合う見出しの段差が 1 を超えない
    for (const [index, level] of levels.slice(1).entries()) {
      expect(level - (levels[index] ?? 0)).toBeLessThanOrEqual(1)
    }
  })
})

/**
 * 画面名の見出しは「見た目を変えずに構造だけ整える」ための追加(#498)。
 * `display: none` に書き換えられると読み上げからも消え、見出しを足した意味が失われる。
 */
describe('読み上げ専用クラス(.srOnly)', () => {
  const rule = (): string => {
    const content = readFileSync(join(SRC_DIR, 'components', 'ui', 'common.module.css'), 'utf8')
    const found = cssRules(content).find(({ selector }) => selector === '.srOnly')
    return (found?.body ?? '').replace(/\s+/g, ' ').trim()
  }

  it('視覚からは取り除くが、読み上げからは消さない', () => {
    const declarations = rule()

    expect(declarations).toContain('clip-path: inset(50%)')
    expect(declarations).not.toContain('display: none')
    expect(declarations).not.toContain('visibility: hidden')
  })

  it('余白を持たず、置いてもレイアウトを動かさない', () => {
    const declarations = rule()

    expect(declarations).toContain('position: absolute')
    expect(declarations).toContain('padding: 0')
  })
})
