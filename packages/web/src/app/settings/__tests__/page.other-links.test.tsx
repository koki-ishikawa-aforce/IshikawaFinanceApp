/**
 * 設定画面下部の「他の画面を開く」リンク群が、見出し付きのまとまりとして
 * 支援技術に伝わることを固定する(#728)。3本になったことでタブの内容とは
 * 別カテゴリの導線群だと伝わりにくいという /ui-review 指摘への対応。
 */
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from '../page'

const apiFetch = vi.fn()

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
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

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  apiFetch.mockReset()
  apiFetch.mockImplementation((path: string, schema: { parse: (input: unknown) => unknown }) => {
    if (path === '/api/settings/profile') {
      return Promise.resolve(
        schema.parse({ profile: { userId: 'U_HONEY', role: 'honey', nickname: null } }),
      )
    }
    return Promise.resolve(schema.parse({ items: [] }))
  })
})

describe('設定画面下部の他画面への入り口リンク', () => {
  it('「その他」の見出し(h2)を持つ', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { level: 2, name: 'その他' })).toBeInTheDocument()
  })

  it('3本のリンクが「その他」見出しでまとまった領域に入っている(見た目だけの区切りではない)', async () => {
    renderPage()

    const group = await screen.findByRole('region', { name: 'その他' })
    for (const name of [/経費精算/, /取込画面/, /オンボーディング/]) {
      expect(group.querySelector(`a[href]`)).not.toBeNull()
      expect(screen.getByRole('link', { name })).toBeInTheDocument()
    }
    expect(group.querySelectorAll('a').length).toBe(3)
  })
})
