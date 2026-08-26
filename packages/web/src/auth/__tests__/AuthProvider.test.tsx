import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getIdToken,
  initLiff,
  isLiffEnabled,
  isLoggedIn,
  LiffInitTimeoutError,
  login,
  logout,
} from '@/lib/liff'
import { AuthProvider, useAuth } from '../AuthProvider'

vi.mock('@/lib/liff', () => ({
  initLiff: vi.fn(),
  isLoggedIn: vi.fn(() => false),
  login: vi.fn(),
  logout: vi.fn(),
  getIdToken: vi.fn((): string | null => null),
  isLiffEnabled: vi.fn(() => false),
  LiffInitTimeoutError: class LiffInitTimeoutError extends Error {},
}))

function AuthProbe() {
  const auth = useAuth()
  return (
    <div>
      <span data-testid="state">
        {auth.initialized ? 'initialized' : 'pending'}/{auth.loggedIn ? 'logged-in' : 'logged-out'}/
        {auth.initTimedOut ? 'timed-out' : 'not-timed-out'}
      </span>
      <span data-testid="token">{auth.idToken ?? '(none)'}</span>
      <button onClick={auth.login}>login</button>
      <button onClick={auth.logout}>logout</button>
      <button onClick={auth.retryInit}>retry</button>
    </div>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isLiffEnabled).mockReturnValue(false)
  vi.mocked(isLoggedIn).mockReturnValue(false)
  vi.mocked(getIdToken).mockReturnValue(null)
})

describe('AuthProvider', () => {
  it('LIFF 無効時は初期化のみ完了し、LIFF init は呼ばない', async () => {
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    )

    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('initialized/logged-out'),
    )
    expect(initLiff).not.toHaveBeenCalled()
  })

  it('LIFF 有効かつログイン済みならトークンを保持する', async () => {
    vi.mocked(isLiffEnabled).mockReturnValue(true)
    vi.mocked(initLiff).mockResolvedValue(undefined)
    vi.mocked(isLoggedIn).mockReturnValue(true)
    vi.mocked(getIdToken).mockReturnValue('token-abc')

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    )

    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('initialized/logged-in'),
    )
    expect(screen.getByTestId('token')).toHaveTextContent('token-abc')
  })

  it('LIFF 初期化に失敗しても initialized にする(未ログイン扱い)', async () => {
    vi.mocked(isLiffEnabled).mockReturnValue(true)
    vi.mocked(initLiff).mockRejectedValue(new Error('init failed'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    )

    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('initialized/logged-out'),
    )
    consoleError.mockRestore()
  })

  it('LIFF 初期化が打ち切り時間内に終わらないと initTimedOut を立て、initialized にはしない', async () => {
    vi.mocked(isLiffEnabled).mockReturnValue(true)
    vi.mocked(initLiff).mockRejectedValue(new LiffInitTimeoutError())

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    )

    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('pending/logged-out/timed-out'),
    )
  })

  it('retryInit で initLiff をやり直し、成功すれば initTimedOut が解消する', async () => {
    const user = userEvent.setup()
    vi.mocked(isLiffEnabled).mockReturnValue(true)
    vi.mocked(initLiff)
      .mockRejectedValueOnce(new LiffInitTimeoutError())
      .mockResolvedValueOnce(undefined)
    vi.mocked(isLoggedIn).mockReturnValue(true)
    vi.mocked(getIdToken).mockReturnValue('token-abc')

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    )
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('pending/logged-out/timed-out'),
    )

    await user.click(screen.getByRole('button', { name: 'retry' }))

    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('initialized/logged-in/not-timed-out'),
    )
    expect(initLiff).toHaveBeenCalledTimes(2)
  })

  it('login はライブラリの login を呼ぶ', async () => {
    const user = userEvent.setup()
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('initialized'))

    await user.click(screen.getByRole('button', { name: 'login' }))

    expect(login).toHaveBeenCalledOnce()
  })

  it('logout でログイン状態とトークンをクリアする', async () => {
    const user = userEvent.setup()
    vi.mocked(isLiffEnabled).mockReturnValue(true)
    vi.mocked(initLiff).mockResolvedValue(undefined)
    vi.mocked(isLoggedIn).mockReturnValue(true)
    vi.mocked(getIdToken).mockReturnValue('token-abc')

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    )
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('initialized/logged-in'),
    )

    await user.click(screen.getByRole('button', { name: 'logout' }))

    expect(logout).toHaveBeenCalledOnce()
    expect(screen.getByTestId('state')).toHaveTextContent('initialized/logged-out')
    expect(screen.getByTestId('token')).toHaveTextContent('(none)')
  })
})
