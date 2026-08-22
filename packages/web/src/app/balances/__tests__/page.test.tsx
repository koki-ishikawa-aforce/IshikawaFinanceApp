/**
 * 残高画面の口座残高カードは、取得中 / エラー / 一覧 が入れ替わる領域を
 * 常時マウントの `role="status"` で包んでいる。中の表示が自前で live region を
 * 作ると同じ文言が二重に読み上げられるため、その入れ子が無いことを固定する。
 */
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BalancesPage from '../page'

const apiFetch = vi.fn()

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client')
  return {
    ...actual,
    apiFetch: (path: string, schema: { parse: (input: unknown) => unknown }) =>
      apiFetch(path, schema),
  }
})

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <BalancesPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  apiFetch.mockReset()
})

/** 「口座残高」の見出しを持つカード（入れ替わる領域を包む器がここにある） */
function balanceCard(): HTMLElement {
  const heading = screen.getByText('口座残高')
  const card = heading.parentElement
  if (card === null) throw new Error('口座残高カードが見つからない')
  return card
}

describe('残高画面の口座残高カード', () => {
  it('一覧の取得に失敗しても、通知は器ひとつだけで二重に読み上げない', async () => {
    apiFetch.mockRejectedValue(new Error('boom'))
    renderPage()

    expect(await screen.findByText('残高一覧の取得に失敗しました')).toBeInTheDocument()
    // 器が role="status" のため、中のエラーは alert を作らず polite で通知される
    expect(within(balanceCard()).queryByRole('alert')).toBeNull()
    expect(within(balanceCard()).getAllByRole('status')).toHaveLength(1)
  })

  it('取得中も、通知は器ひとつだけで「読み込み中...」を伝える', () => {
    apiFetch.mockReturnValue(new Promise(() => {}))
    renderPage()

    const statuses = within(balanceCard()).getAllByRole('status')
    expect(statuses).toHaveLength(1)
    expect(statuses[0]).toHaveTextContent('読み込み中...')
  })
})
