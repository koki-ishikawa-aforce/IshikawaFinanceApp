import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getIdToken, initLiff, isLiffEnabled, isLoggedIn } from '@/lib/liff'
import { AuthGate } from '../AuthGate'
import { AuthProvider } from '../AuthProvider'

vi.mock('@/lib/liff', () => ({
  initLiff: vi.fn(),
  isLoggedIn: vi.fn(() => false),
  login: vi.fn(),
  logout: vi.fn(),
  getIdToken: vi.fn((): string | null => null),
  isLiffEnabled: vi.fn(() => false),
}))

function renderGate() {
  return render(
    <AuthProvider>
      <AuthGate>
        <div>protected content</div>
      </AuthGate>
    </AuthProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isLiffEnabled).mockReturnValue(false)
  vi.mocked(isLoggedIn).mockReturnValue(false)
  vi.mocked(getIdToken).mockReturnValue(null)
})

describe('AuthGate', () => {
  it('LIFF 無効時は子要素をそのまま表示する', () => {
    renderGate()

    expect(screen.getByText('protected content')).toBeInTheDocument()
  })

  it('LIFF 有効・初期化中は何も表示しない', () => {
    vi.mocked(isLiffEnabled).mockReturnValue(true)
    vi.mocked(initLiff).mockReturnValue(new Promise(() => {}))

    renderGate()

    expect(screen.queryByText('protected content')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'LINE でログイン' })).not.toBeInTheDocument()
  })

  it('LIFF 有効・未ログインならログイン画面を表示する', async () => {
    vi.mocked(isLiffEnabled).mockReturnValue(true)
    vi.mocked(initLiff).mockResolvedValue(undefined)
    vi.mocked(isLoggedIn).mockReturnValue(false)

    renderGate()

    expect(await screen.findByRole('button', { name: 'LINE でログイン' })).toBeInTheDocument()
    expect(screen.queryByText('protected content')).not.toBeInTheDocument()
  })

  it('LIFF 有効・ログイン済みなら子要素を表示する', async () => {
    vi.mocked(isLiffEnabled).mockReturnValue(true)
    vi.mocked(initLiff).mockResolvedValue(undefined)
    vi.mocked(isLoggedIn).mockReturnValue(true)
    vi.mocked(getIdToken).mockReturnValue('token-abc')

    renderGate()

    await waitFor(() => expect(screen.getByText('protected content')).toBeInTheDocument())
  })
})
