/**
 * 共通トークルーム参加ステップが「Webhook 由来記録の確認」であることを固定する（#298）。
 *
 * 参加の正は join Webhook（08f §2）のみで、画面からの自己申告 API は廃止済み。未検知のあいだは
 * 「まだ検知できていません」の案内で待機し、次のステップへは進めないこと、「最新の状態を確認」を
 * 押すと検知状況を取り直すことを、画面の結線として検証する。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OnboardingPage from '../page'

const apiFetch = vi.fn()

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client')
  return {
    ...actual,
    apiFetch: (path: string, schema: { parse: (input: unknown) => unknown }) =>
      apiFetch(path, schema),
  }
})

/** 友だち追加は完了済み・共通トークルームは未参加（= トークルーム参加ステップに留まる） */
function appUser(): unknown {
  return {
    kind: 'phase1_completed',
    common: {
      userId: 'U_HONEY',
      role: 'honey',
      nickname: 'はにー',
      firstRegisteredAt: '2026-01-01T00:00:00.000Z',
      lineOperationSettings: {
        friendAdd: { kind: 'added', followWebhookReceivedAt: '2026-01-01T00:00:00.000Z' },
        notificationActivation: { kind: 'not_activated' },
      },
    },
  }
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <OnboardingPage />
    </QueryClientProvider>,
  )
}

let joined = false

beforeEach(() => {
  apiFetch.mockReset()
  joined = false
  apiFetch.mockImplementation((path: string, schema: { parse: (input: unknown) => unknown }) => {
    if (path === '/api/me') return Promise.resolve({ viewerId: 'U_HONEY', role: 'honey' })
    if (path === '/api/onboarding/me') {
      return Promise.resolve(
        schema.parse({
          user: appUser(),
          sharedTalkRoom: { kind: joined ? 'joined' : 'not_joined' },
        }),
      )
    }
    return Promise.resolve(schema.parse({}))
  })
})

describe('共通トークルームへの参加の確認', () => {
  it('未検知のあいだは「まだ検知できていません」の案内が出て、自己申告で進む手段は無い（#298）', async () => {
    renderPage()

    expect(
      await screen.findByText(/まだ検知できていません。参加してから少し時間をおいて/),
    ).toBeInTheDocument()
    // 自己申告 API（廃止済み）に対応するボタンは存在しない
    expect(screen.queryByRole('button', { name: '参加しました' })).toBeNull()
  })

  it('「最新の状態を確認」を押すと検知状況を取り直し、参加済みなら次の手順へ進む', async () => {
    renderPage()
    await screen.findByText(/まだ検知できていません/)
    const callsBeforeRefetch = apiFetch.mock.calls.filter(
      ([path]) => path === '/api/onboarding/me',
    ).length

    joined = true
    await userEvent.click(await screen.findByRole('button', { name: '最新の状態を確認' }))

    await waitFor(() =>
      expect(
        apiFetch.mock.calls.filter(([path]) => path === '/api/onboarding/me').length,
      ).toBeGreaterThan(callsBeforeRefetch),
    )
    expect(await screen.findByText('通知の設定')).toBeInTheDocument()
  })
})
