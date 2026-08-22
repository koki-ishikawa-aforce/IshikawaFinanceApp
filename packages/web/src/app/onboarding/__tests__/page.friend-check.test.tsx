/**
 * 友だち追加の確認をやり直す導線（#417 A）の結線を固定する。
 *
 * 登録時の照会が失敗した人は「友だち未追加」の扱いのまま止まり、通知の設定へ進めない。
 * 確認できたら先へ進むこと、確認できなかったときに理由に応じた次の行動が案内されることが
 * この導線の値打ちのため、画面の結線として検証する。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OnboardingPage from '../page'

const apiFetch = vi.fn()
const apiMutate = vi.fn()

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client')
  return {
    ...actual,
    apiFetch: (path: string, schema: { parse: (input: unknown) => unknown }) =>
      apiFetch(path, schema),
    apiMutate: (
      path: string,
      options: { method: string; body?: unknown },
      schema: { parse: (input: unknown) => unknown },
    ) => apiMutate(path, options, schema),
  }
})

/** 登録済み・ニックネーム設定済み・友だち追加は未記録（= 友だち追加ステップに留まる） */
function appUser(friendAdd: 'not_added' | 'added'): unknown {
  return {
    kind: 'phase1_completed',
    common: {
      userId: 'U_HONEY',
      role: 'honey',
      nickname: 'はにー',
      firstRegisteredAt: '2026-01-01T00:00:00.000Z',
      lineOperationSettings: {
        friendAdd: { kind: friendAdd },
        notificationActivation: { kind: 'not_activated' },
      },
    },
  }
}

function meResponse(friendAdd: 'not_added' | 'added'): unknown {
  return { user: appUser(friendAdd), sharedTalkRoom: { kind: 'not_joined' } }
}

function checkResponse(kind: 'confirmed' | 'not_friend' | 'unavailable'): unknown {
  return { user: appUser(kind === 'confirmed' ? 'added' : 'not_added'), result: { kind } }
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <OnboardingPage />
    </QueryClientProvider>,
  )
}

/** 応答はワイヤー形式のスキーマを通して返す（画面が受け取れない形なら落ちるようにする） */
function respondWith(
  response: unknown,
): (
  path: string,
  options: unknown,
  schema: { parse: (input: unknown) => unknown },
) => Promise<unknown> {
  return (_path, _options, schema) => Promise.resolve(schema.parse(response))
}

beforeEach(() => {
  apiFetch.mockReset()
  apiMutate.mockReset()
  apiFetch.mockImplementation((path: string, schema: { parse: (input: unknown) => unknown }) => {
    if (path === '/api/me') return Promise.resolve({ viewerId: 'U_HONEY', role: 'honey' })
    if (path === '/api/onboarding/me') return Promise.resolve(schema.parse(meResponse('not_added')))
    return Promise.resolve(schema.parse({}))
  })
})

describe('友だち追加の確認', () => {
  it('確認を押すと LINE へ問い合わせ直す（登録し直さずに立て直せる）', async () => {
    apiMutate.mockImplementation(respondWith(checkResponse('confirmed')))
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: '友だち追加を確認する' }))

    await waitFor(() => expect(apiMutate).toHaveBeenCalledTimes(1))
    expect(apiMutate.mock.calls[0]?.[0]).toBe('/api/onboarding/phase1/line-friend/check')
    expect(apiMutate.mock.calls[0]?.[1]?.method).toBe('POST')
  })

  it('確認できたら案内は出さず、進捗を取り直す', async () => {
    apiMutate.mockImplementation(respondWith(checkResponse('confirmed')))
    renderPage()
    await screen.findByRole('button', { name: '友だち追加を確認する' })
    const fetchesBefore = apiFetch.mock.calls.length

    await userEvent.click(screen.getByRole('button', { name: '友だち追加を確認する' }))

    await waitFor(() => expect(apiFetch.mock.calls.length).toBeGreaterThan(fetchesBefore))
    expect(screen.queryByText(/友だち追加を確認できませんでした/)).toBeNull()
    expect(screen.queryByText(/LINE に問い合わせできませんでした/)).toBeNull()
  })

  it('まだ友だち追加されていなければ、先に友だち追加するよう案内する', async () => {
    apiMutate.mockImplementation(respondWith(checkResponse('not_friend')))
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: '友だち追加を確認する' }))

    const note = await screen.findByText(/友だち追加を確認できませんでした/)
    expect(note.textContent).toContain('もう一度')
    // 結果は押した場所で差し替わるため、読み上げに載せる（使用性 8-4）
    expect(note.closest('[role="status"]')).not.toBeNull()
  })

  it('LINE へ問い合わせできなかったときは、友だち未追加と混同させずにやり直しを案内する', async () => {
    apiMutate.mockImplementation(respondWith(checkResponse('unavailable')))
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: '友だち追加を確認する' }))

    const note = await screen.findByText(/LINE に問い合わせできませんでした/)
    expect(note.closest('[role="status"]')).not.toBeNull()
    // 「友だち追加すればよい」と読める案内を出さない（通信の失敗を利用者の未操作にすり替えない）
    expect(screen.queryByText(/友だち追加を確認できませんでした/)).toBeNull()
  })

  it('確認中はボタンを押せず、進行中であることが分かる', async () => {
    let resolveCheck: (value: unknown) => void = () => undefined
    apiMutate.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveCheck = resolve
        }),
    )
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: '友だち追加を確認する' }))

    const pending = await screen.findByRole('button', { name: '確認中...' })
    expect(pending).toBeDisabled()
    resolveCheck(checkResponse('not_friend'))
  })
})
