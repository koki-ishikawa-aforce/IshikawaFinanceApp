/**
 * はじめての設定 Section B（初期残高の登録、#395）の結線を固定する。
 *
 * 本番では口座が 1 つも無い状態から始まるため、この手順は「口座がまだ無い人に登録の入口を示す」
 * ことと「自分名義の口座で確定する」ことの両方ができないと完走できない。どちらも画面の結線に
 * しか現れないため、ここで検証する。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OnboardingPage from '../page'
import { ApiError } from '@/lib/api-client'

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

const VIEWER_ID = 'U_HONEY'

/** Section A 完了・Section B 未完了の Phase2 進行中ユーザー（Section B が出る状態） */
function meResponse(): unknown {
  return {
    user: {
      kind: 'phase2_in_progress',
      common: {
        userId: VIEWER_ID,
        role: 'honey',
        nickname: 'はにー',
        firstRegisteredAt: '2026-01-01T00:00:00.000Z',
      },
      progress: {
        sectionA: { kind: 'completed' },
        sectionB: { kind: 'not_started' },
        sectionF: { kind: 'skipped' },
      },
    },
    sharedTalkRoom: {
      kind: 'joined',
      talkRoomId: 'room_001',
      joinedAt: '2026-01-01T00:00:00.000Z',
    },
  }
}

const active = { kind: 'active' } as const

function ownAccount(kind: string, accountId: string): unknown {
  const common = { accountId, ownerUserId: VIEWER_ID, activeness: active }
  switch (kind) {
    case 'smbc_bank':
      return { kind, common, balance: { currentBalance: 1500000 } }
    case 'mitsui_sumitomo_card':
      return { kind, common }
    case 'other_savings':
      return { kind, common, bankName: '楽天銀行', balance: { currentBalance: 500000 } }
    default:
      return {
        kind,
        common,
        brokerageName: { kind: 'sbi' },
        contribution: { currentAccumulated: 0 },
      }
  }
}

/** 自分の口座一覧（GET /api/accounts）。指定した種別だけが登録済みになる */
let ownAccountKinds: string[] = []
/** 口座一覧の取得を失敗させるか */
let accountsFail = false

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <OnboardingPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  apiFetch.mockReset()
  apiMutate.mockReset()
  ownAccountKinds = []
  accountsFail = false
  apiFetch.mockImplementation((path: string, schema: { parse: (input: unknown) => unknown }) => {
    if (path === '/api/me') return Promise.resolve({ viewerId: VIEWER_ID, role: 'honey' })
    if (path === '/api/onboarding/me') return Promise.resolve(schema.parse(meResponse()))
    if (path === '/api/accounts') {
      if (accountsFail) return Promise.reject(new ApiError(500, 'サーバーエラー'))
      return Promise.resolve(
        schema.parse({
          items: ownAccountKinds.map((kind, i) => ownAccount(kind, `ACC_${i + 1}`)),
        }),
      )
    }
    return Promise.resolve(schema.parse({}))
  })
})

describe('はじめての設定 Section B（初期残高の登録）', () => {
  it('必要な口座が揃っていれば、自分の口座 ID で初期残高を確定できる', async () => {
    ownAccountKinds = ['smbc_bank', 'other_savings', 'nisa']
    apiMutate.mockImplementation((_path, _options, schema: { parse: (i: unknown) => unknown }) =>
      Promise.resolve(schema.parse({ user: meResponse() })),
    )
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: '登録済みの口座で確定する' }))

    await waitFor(() => expect(apiMutate).toHaveBeenCalledTimes(1))
    expect(apiMutate.mock.calls[0]?.[0]).toBe('/api/onboarding/phase2/section-b')
    expect(apiMutate.mock.calls[0]?.[1]?.body).toEqual({
      initialBalanceRef: {
        smbcAccountId: 'ACC_1',
        otherSavingsAccountId: 'ACC_2',
        nisaAccountId: 'ACC_3',
      },
    })
  })

  it('世帯の残高一覧ではなく自分の口座一覧から組み立てる（配偶者名義の口座を送らない）', async () => {
    ownAccountKinds = ['smbc_bank', 'other_savings', 'nisa']
    renderPage()

    await screen.findByRole('button', { name: '登録済みの口座で確定する' })
    const paths = apiFetch.mock.calls.map(call => call[0])
    expect(paths).toContain('/api/accounts')
    expect(paths).not.toContain('/api/balances')
  })

  it('口座が 1 つも無ければ、足りない口座の名前と登録の入口を案内する', async () => {
    renderPage()

    const note = await screen.findByText(/まだ登録されていません/)
    expect(note.textContent).toContain('SMBC銀行口座')
    expect(note.textContent).toContain('別銀行貯蓄口座')
    expect(note.textContent).toContain('NISA口座')
    for (const name of ['SMBC銀行口座を登録', '別銀行貯蓄口座を登録', 'NISA口座を登録']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    // 揃っていないうちは確定させない
    expect(screen.queryByRole('button', { name: '登録済みの口座で確定する' })).toBeNull()
  })

  it('足りない口座はこの画面から登録できる（設定画面へ移らずに完走できる）', async () => {
    ownAccountKinds = ['other_savings', 'nisa']
    apiMutate.mockImplementation((_path, _options, schema: { parse: (i: unknown) => unknown }) =>
      Promise.resolve(schema.parse({})),
    )
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'SMBC銀行口座を登録' }))
    await userEvent.type(screen.getByLabelText('現在の残高（円、初期残高として登録）'), '1500000')
    await userEvent.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(apiMutate).toHaveBeenCalledTimes(1))
    expect(apiMutate.mock.calls[0]?.[0]).toBe('/api/accounts')
    expect(apiMutate.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: { kind: 'smbc_bank', initialBalance: 1500000 },
    })
  })

  it('一部だけ足りないときは、足りない口座だけを挙げる', async () => {
    ownAccountKinds = ['smbc_bank', 'nisa']
    renderPage()

    const note = await screen.findByText(/まだ登録されていません/)
    expect(note.textContent).toContain('別銀行貯蓄口座')
    expect(note.textContent).not.toContain('SMBC銀行口座')
    expect(note.textContent).not.toContain('NISA口座')
  })

  it('三井住友カードが未登録なら、カード利用の取込に必要だと補足する（この手順は止めない）', async () => {
    ownAccountKinds = ['smbc_bank', 'other_savings', 'nisa']
    renderPage()

    expect(await screen.findByText(/クレジットカードの利用を取り込むには/)).toBeInTheDocument()
    // 必須ではないので確定は妨げない
    expect(screen.getByRole('button', { name: '登録済みの口座で確定する' })).toBeEnabled()
  })

  it('三井住友カードが登録済みなら、カードの補足は出さない', async () => {
    ownAccountKinds = ['smbc_bank', 'mitsui_sumitomo_card', 'other_savings', 'nisa']
    renderPage()

    await screen.findByRole('button', { name: '登録済みの口座で確定する' })
    expect(screen.queryByText(/クレジットカードの利用を取り込むには/)).toBeNull()
  })

  it('口座の登録状況を確認できなかったときは、未登録と混同させずにやり直しを案内する', async () => {
    accountsFail = true
    renderPage()

    const error = await screen.findByText(/口座の登録状況を確認できませんでした/)
    expect(error.closest('[role="alert"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'もう一度確認する' })).toBeInTheDocument()
    // 「口座が無い」と読める案内は出さない（通信の失敗を利用者の未操作にすり替えない）
    expect(screen.queryByText(/まだ登録されていません/)).toBeNull()
  })
})
