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
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { cssRules } from '@/test/css-rules'
import { SRC_DIR } from '@/test/sources'
import ui from '@/components/ui/common.module.css'
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
  it('画面名の見出し(h1)を 1 つ持ち、画面には文字として出さない', () => {
    renderDashboard()

    // 文言は下部ナビの項目名と揃える(同 5-1)。利用者が目にしない「ダッシュボード」は使わない
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveTextContent('ホーム')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    // 「見た目は変えない」が決定の中身。可視のクラス(ui.pageTitle 等)に
    // 取り違えたり、クラスを落としたりするとここで落ちる。
    // クラス名が消えるとアサーションが空振りするため、存在も併せて確認する
    expect(ui.srOnly).toBeTruthy()
    const classNames = h1.className.split(' ')
    expect(classNames).toContain(ui.srOnly)
    expect(classNames).not.toContain(ui.pageTitle)
  })

  it('KPI とカテゴリ内訳、それぞれのセクション見出しが h2 として扱われる', () => {
    renderDashboard()

    const headings = screen.getAllByRole('heading', { level: 2 })
    expect(headings.map(heading => heading.textContent)).toEqual([
      '今月の状況',
      '世帯支出（カテゴリ別）',
    ])
  })

  it('個人モードに切り替えても h2 のまま文言だけが変わる', async () => {
    renderDashboard()
    const user = userEvent.setup()

    await user.click(screen.getByRole('radio', { name: '個人' }))

    const headings = screen.getAllByRole('heading', { level: 2 })
    expect(headings.map(heading => heading.textContent)).toEqual([
      '今月の状況',
      '個人支出（カテゴリ別）',
    ])
  })

  it('文書順で見出しの階層を飛ばさない', () => {
    renderDashboard()

    // getAllByRole は文書順で返る。並べ替えると「h2 が h1 より前」を見逃す
    const levels = screen.getAllByRole('heading').map(heading => Number(heading.tagName.slice(1)))

    expect(levels[0]).toBe(1)
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
