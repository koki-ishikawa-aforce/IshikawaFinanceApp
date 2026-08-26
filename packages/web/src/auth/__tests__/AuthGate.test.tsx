import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getIdToken, initLiff, isLiffEnabled, isLoggedIn, LiffInitTimeoutError } from '@/lib/liff'
import { NETWORK_ERROR_MESSAGE } from '@/lib/api-client'
import { AuthGate } from '../AuthGate'
import { AuthProvider } from '../AuthProvider'

vi.mock('@/lib/liff', () => ({
  initLiff: vi.fn(),
  isLoggedIn: vi.fn(() => false),
  login: vi.fn(),
  logout: vi.fn(),
  getIdToken: vi.fn((): string | null => null),
  isLiffEnabled: vi.fn(() => false),
  LiffInitTimeoutError: class LiffInitTimeoutError extends Error {},
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

  it('LIFF 有効・初期化中は読み込み中を表示する', () => {
    vi.mocked(isLiffEnabled).mockReturnValue(true)
    vi.mocked(initLiff).mockReturnValue(new Promise(() => {}))

    renderGate()

    expect(screen.getByText('読み込み中...')).toBeInTheDocument()
    expect(screen.queryByText('protected content')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'LINE でログイン' })).not.toBeInTheDocument()
  })

  it('LIFF 初期化が打ち切り時間内に終わらないと通信できない旨の失敗表示を出す(#577)', async () => {
    vi.mocked(isLiffEnabled).mockReturnValue(true)
    vi.mocked(initLiff).mockRejectedValue(new LiffInitTimeoutError())

    renderGate()

    expect(await screen.findByRole('alert')).toHaveTextContent(NETWORK_ERROR_MESSAGE)
    expect(screen.queryByText('protected content')).not.toBeInTheDocument()
  })

  it('失敗表示の再読み込みで初期化をやり直し、成功すれば子要素を表示する(#577)', async () => {
    vi.mocked(isLiffEnabled).mockReturnValue(true)
    vi.mocked(initLiff)
      .mockRejectedValueOnce(new LiffInitTimeoutError())
      .mockResolvedValueOnce(undefined)
    vi.mocked(isLoggedIn).mockReturnValue(true)
    vi.mocked(getIdToken).mockReturnValue('token-abc')

    const user = userEvent.setup()
    renderGate()

    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: '再読み込み' }))

    await waitFor(() => expect(screen.getByText('protected content')).toBeInTheDocument())
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
