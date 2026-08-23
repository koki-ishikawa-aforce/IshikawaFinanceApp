/**
 * 設定 > 月次上限の取得失敗の見せ方を固定する。
 *
 * このタブは経費種別と上限の 2 つを取り、どちらが落ちても 1 つのエラー表示にまとめる。
 * まとめ方を間違える（片方の失敗しか渡さない）と、圏外で「月次上限の取得に失敗しました」
 * だけが出て、電波のせいだと分からない状態が残る（`docs/design/usability.md` §7-7）。
 */
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from '../page'
import { NetworkError, NETWORK_ERROR_MESSAGE } from '@/lib/api-client'

const apiFetch = vi.fn()

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('section=limits'),
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client')
  return {
    ...actual,
    apiFetch: (path: string, schema: { parse: (input: unknown) => unknown }) =>
      apiFetch(path, schema),
    apiMutate: vi.fn(),
  }
})

/** path 単位で成功・失敗を切り替える。片方だけ落ちる状況を作るために使う */
function stubFetch(failing: '/api/expense-types' | '/api/monthly-limits', error: Error): void {
  apiFetch.mockImplementation((path: string) => {
    if (path === failing) return Promise.reject(error)
    return Promise.resolve({ items: [] })
  })
}

function renderLimitsTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  apiFetch.mockReset()
})

describe('設定 > 月次上限の取得失敗', () => {
  it('上限側が通信で失敗したら共通の文言を出す', async () => {
    stubFetch('/api/monthly-limits', new NetworkError('unreachable'))
    renderLimitsTab()

    expect(await screen.findByText(NETWORK_ERROR_MESSAGE)).toBeInTheDocument()
  })

  it('経費種別側が通信で失敗しても共通の文言を出す', async () => {
    stubFetch('/api/expense-types', new NetworkError('unreachable'))
    renderLimitsTab()

    expect(await screen.findByText(NETWORK_ERROR_MESSAGE)).toBeInTheDocument()
  })

  it('サーバーが返した失敗なら画面固有の文言を出す', async () => {
    stubFetch('/api/monthly-limits', new Error('boom'))
    renderLimitsTab()

    expect(await screen.findByText('月次上限の取得に失敗しました')).toBeInTheDocument()
  })
})
