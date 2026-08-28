/**
 * 設定画面の Gmail 連携タブ（#392）の状態別表示と再認可導線を固定する。
 *
 * このタブは OAuth 失効通知の LINE DM（`/settings?section=oauth&provider=gmail`）の
 * 受け側。失効状態で再認可ボタンが出ないと、通知から来た利用者が復旧できない。
 */
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from '../page'

const apiFetch = vi.fn()
const apiMutate = vi.fn()
const openExternal = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('section=oauth&provider=gmail'),
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('@/lib/liff', () => ({ openExternal }))

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client')
  return {
    ...actual,
    apiFetch: (path: string, schema: { parse: (input: unknown) => unknown }) =>
      apiFetch(path, schema),
    apiMutate: (path: string, options: unknown, schema: { parse: (input: unknown) => unknown }) =>
      apiMutate(path, options, schema),
  }
})

function mockGmailLink(gmailLink: unknown) {
  apiFetch.mockImplementation((path: string, schema: { parse: (input: unknown) => unknown }) => {
    if (path === '/api/settings/gmail-link') {
      return Promise.resolve(schema.parse({ gmailLink }))
    }
    return Promise.resolve(schema.parse({ items: [] }))
  })
}

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
  apiMutate.mockReset()
  openExternal.mockReset()
})

describe('Gmail 連携タブ', () => {
  it('連携中は状態と連携日を表示し、再認可の操作は出さない', async () => {
    mockGmailLink({ kind: 'valid', authorizedAt: '2026-05-01T09:00:00.000Z' })
    renderPage()

    expect(await screen.findByText('連携中')).toBeInTheDocument()
    expect(screen.getByText(/連携した日: 2026\/05\/01/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Gmail を連携し直す' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Gmail 連携をはじめる' })).not.toBeInTheDocument()
  })

  it('失効検知済みは検知日と警告を表示し、再認可ボタンで認可 URL を外部ブラウザに開く', async () => {
    mockGmailLink({ kind: 'revocation_detected', revocationDetectedAt: '2026-07-10T21:00:00.000Z' })
    apiMutate.mockResolvedValue({ authorizationUrl: 'https://accounts.google.com/o/oauth2/auth' })
    renderPage()

    expect(await screen.findByText('連携が切れています')).toBeInTheDocument()
    // 検知日時は JST の暦日で出す（2026-07-10T21:00Z = JST 7/11）
    expect(screen.getByText(/2026\/07\/11/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Gmail を連携し直す' }))

    expect(apiMutate).toHaveBeenCalledWith(
      '/api/onboarding/gmail/authorize',
      { method: 'POST' },
      expect.anything(),
    )
    expect(openExternal).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/auth')
  })

  it('未連携は連携開始ボタンを出す', async () => {
    mockGmailLink({ kind: 'not_linked' })
    renderPage()

    expect(await screen.findByText('未連携')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Gmail 連携をはじめる' })).toBeInTheDocument()
  })

  it('認可 URL の発行に失敗したらエラーを表示し、外部ブラウザを開かない', async () => {
    mockGmailLink({ kind: 'revocation_detected', revocationDetectedAt: '2026-07-10T21:00:00.000Z' })
    apiMutate.mockRejectedValue(new Error('network down'))
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Gmail を連携し直す' }))

    expect(await screen.findByText(/Gmail の連携を開始できませんでした/)).toBeInTheDocument()
    expect(openExternal).not.toHaveBeenCalled()
  })
})
