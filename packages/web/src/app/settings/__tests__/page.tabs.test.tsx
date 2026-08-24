/**
 * 設定画面のタブと、そこに出る中身の結線を固定する。
 *
 * 各タブの中身そのものは部品側のテスト（`components/settings/__tests__/`）が見る。ここで見るのは
 * 「`?section=` で選ばれたタブに、その部品が出るか」だけ。結線が切れると、口座の追加や学習ルールの
 * 停止といった導線ごと画面から消えるが、部品側のテストは部品を直接描画するため気づけない。
 */
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from '../page'

const apiFetch = vi.fn()
const section = vi.fn(() => 'profile')

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(`section=${section()}`),
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

describe('設定画面のタブと中身の結線', () => {
  // タブの見出し文字はタブボタン自身にも出るため、その中身にしか現れない目印で判定する
  it.each([
    ['profile', () => screen.findByText('役割（変更不可）')],
    ['accounts', () => screen.findByText('口座管理')],
    ['categories', () => screen.findByPlaceholderText('新しいカテゴリ名')],
    ['expense-types', () => screen.findByPlaceholderText('新しい経費種別名')],
    [
      'limits',
      () =>
        screen.findByText(
          '経費種別ごとに月あたりの経費上限を設定します。上限を超えた分は個人負担として按分されます。',
        ),
    ],
    ['classification', () => screen.findByText('加盟店の学習')],
  ])('?section=%s ではその中身が出る', async (value, findContent) => {
    section.mockReturnValue(value)
    renderPage()

    expect(await findContent()).toBeInTheDocument()
  })
})
