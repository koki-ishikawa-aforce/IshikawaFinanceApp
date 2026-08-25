/**
 * はじめての設定画面のボタンが、押している最中に進行を示す文言へ変わることを固定する（#556）。
 *
 * この画面は元々「決定して次へ」などを押しても disabled になるだけで文字が変わらず、
 * 「友だち追加を確認する」（→「確認中...」）とだけ書き方が混ざっていた。通信が遅いときに
 * 押せているのか分からず何度も押させる原因になるため、9 個のボタンすべてに進行中の文言を
 * 揃えたことを、画面の結線として検証する（実装をなぞらず、押している間に何が見えるかを見る）。
 */
import { render, screen } from '@testing-library/react'
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

const VIEWER_ID = 'U_HONEY'
const REGISTERED_AT = '2026-01-01T00:00:00.000Z'

/** 押している間、二度と解決しない要求を返す(進行中の見た目を固定して観察するため) */
function neverResolve(): void {
  apiMutate.mockImplementation(() => new Promise(() => undefined))
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <OnboardingPage />
    </QueryClientProvider>,
  )
}

function mockMeAnd(user: unknown, sharedTalkRoom: unknown = { kind: 'not_joined' }): void {
  apiFetch.mockImplementation((path: string, schema: { parse: (input: unknown) => unknown }) => {
    if (path === '/api/me') return Promise.resolve({ viewerId: VIEWER_ID, role: 'honey' })
    if (path === '/api/onboarding/me')
      return Promise.resolve(schema.parse({ user, sharedTalkRoom }))
    if (path === '/api/accounts') return Promise.resolve(schema.parse({ items: [] }))
    if (path.startsWith('/api/imports/status')) {
      return Promise.resolve(schema.parse({ completion: null }))
    }
    return Promise.resolve(schema.parse({}))
  })
}

beforeEach(() => {
  apiFetch.mockReset()
  apiMutate.mockReset()
})

describe('はじめての設定 各ボタンの進行中の文言', () => {
  it('友だち追加しました: 記録中は「記録中...」に変わる', async () => {
    mockMeAnd({
      kind: 'phase1_completed',
      common: {
        userId: VIEWER_ID,
        role: 'honey',
        nickname: 'はにー',
        firstRegisteredAt: REGISTERED_AT,
        lineOperationSettings: {
          friendAdd: { kind: 'not_added' },
          notificationActivation: { kind: 'not_activated' },
        },
      },
    })
    neverResolve()
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: '友だち追加しました' }))

    const pending = await screen.findByRole('button', { name: '記録中...' })
    expect(pending).toBeDisabled()
  })

  it('参加を記録するトークルームを特定できないときは、通信失敗と同じ共通表示で案内する', async () => {
    // LIFF グループ外・運用ルーム未設定の test 環境では talkRoomId が常に null になる
    mockMeAnd({
      kind: 'phase1_completed',
      common: {
        userId: VIEWER_ID,
        role: 'honey',
        nickname: 'はにー',
        firstRegisteredAt: REGISTERED_AT,
        lineOperationSettings: {
          friendAdd: { kind: 'added' },
          notificationActivation: { kind: 'not_activated' },
        },
      },
    })
    renderPage()

    const message = await screen.findByText(
      'トークルームが特定できませんでした。共通トークルーム内からこの画面を開き直してください。',
    )
    // 通信の失敗（unavailable）と同じ共通のエラー表示に揃える（灰色の独自注意書きを廃止）
    expect(message.closest('[role="alert"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: '参加しました' })).toBeDisabled()
  })

  it('通知を受け取る: 記録中は「設定中...」に変わる', async () => {
    mockMeAnd(
      {
        kind: 'phase1_completed',
        common: {
          userId: VIEWER_ID,
          role: 'honey',
          nickname: 'はにー',
          firstRegisteredAt: REGISTERED_AT,
          lineOperationSettings: {
            friendAdd: { kind: 'added' },
            notificationActivation: { kind: 'not_activated' },
          },
        },
      },
      { kind: 'joined' },
    )
    neverResolve()
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: '通知を受け取る' }))

    const pending = await screen.findByRole('button', { name: '設定中...' })
    expect(pending).toBeDisabled()
  })

  it('Phase 2 を開始する: 記録中は「開始中...」に変わる', async () => {
    mockMeAnd(
      {
        kind: 'phase1_completed',
        common: {
          userId: VIEWER_ID,
          role: 'honey',
          nickname: 'はにー',
          firstRegisteredAt: REGISTERED_AT,
          lineOperationSettings: {
            friendAdd: { kind: 'added' },
            notificationActivation: { kind: 'activated' },
          },
        },
      },
      { kind: 'joined' },
    )
    neverResolve()
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Phase 2 を開始する' }))

    const pending = await screen.findByRole('button', { name: '開始中...' })
    expect(pending).toBeDisabled()
  })

  function phase2Progress(overrides: {
    sectionA?: 'not_started' | 'completed'
    sectionB?: 'not_started' | 'completed'
    sectionF?: 'not_started' | 'skipped'
  }): unknown {
    return {
      sectionA: { kind: overrides.sectionA ?? 'not_started' },
      sectionB: { kind: overrides.sectionB ?? 'not_started' },
      sectionC: { kind: 'unconfirmed' },
      sectionD: { kind: 'unconfirmed' },
      sectionE: { kind: 'unconfirmed' },
      sectionF: { kind: overrides.sectionF ?? 'skipped' },
    }
  }

  function phase2User(progress: unknown): unknown {
    return {
      kind: 'phase2_in_progress',
      common: {
        userId: VIEWER_ID,
        role: 'honey',
        nickname: 'はにー',
        firstRegisteredAt: REGISTERED_AT,
      },
      progress,
    }
  }

  it('Gmail 連携をはじめる: 認可の要求中は「連携準備中...」に変わる', async () => {
    mockMeAnd(phase2User(phase2Progress({})), { kind: 'joined' })
    neverResolve()
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Gmail 連携をはじめる' }))

    const pending = await screen.findByRole('button', { name: '連携準備中...' })
    expect(pending).toBeDisabled()
  })

  it('登録済みの口座で確定する: 記録中は「確定中...」に変わる', async () => {
    mockMeAnd(phase2User(phase2Progress({ sectionA: 'completed', sectionB: 'not_started' })), {
      kind: 'joined',
    })
    apiFetch.mockImplementation((path: string, schema: { parse: (input: unknown) => unknown }) => {
      if (path === '/api/me') return Promise.resolve({ viewerId: VIEWER_ID, role: 'honey' })
      if (path === '/api/onboarding/me') {
        return Promise.resolve(
          schema.parse({
            user: phase2User(phase2Progress({ sectionA: 'completed', sectionB: 'not_started' })),
            sharedTalkRoom: { kind: 'joined' },
          }),
        )
      }
      if (path === '/api/accounts') {
        const common = (accountId: string) => ({
          accountId,
          ownerUserId: VIEWER_ID,
          activeness: { kind: 'active' },
        })
        return Promise.resolve(
          schema.parse({
            items: [
              { kind: 'smbc_bank', common: common('ACC_1'), balance: { currentBalance: 100 } },
              {
                kind: 'other_savings',
                common: common('ACC_2'),
                bankName: '楽天銀行',
                balance: { currentBalance: 100 },
              },
              {
                kind: 'nisa',
                common: common('ACC_3'),
                brokerageName: { kind: 'sbi' },
                contribution: { currentAccumulated: 0 },
              },
            ],
          }),
        )
      }
      return Promise.resolve(schema.parse({}))
    })
    neverResolve()
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: '登録済みの口座で確定する' }))

    const pending = await screen.findByRole('button', { name: '確定中...' })
    expect(pending).toBeDisabled()
  })

  it('過去明細の取込「完了にする」「スキップ」: 押した側だけが「記録中...」になる（もう一方は元の文言のまま）', async () => {
    mockMeAnd(phase2User(phase2Progress({ sectionF: 'not_started' })), { kind: 'joined' })
    apiFetch.mockImplementation((path: string, schema: { parse: (input: unknown) => unknown }) => {
      if (path === '/api/me') return Promise.resolve({ viewerId: VIEWER_ID, role: 'honey' })
      if (path === '/api/onboarding/me') {
        return Promise.resolve(
          schema.parse({
            user: phase2User(phase2Progress({ sectionF: 'not_started' })),
            sharedTalkRoom: { kind: 'joined' },
          }),
        )
      }
      if (path.startsWith('/api/imports/status')) {
        return Promise.resolve(
          schema.parse({
            completion: {
              userId: VIEWER_ID,
              targetMonth: '2026-02',
              importJobId: 'JOB_1',
              completedAt: REGISTERED_AT,
            },
          }),
        )
      }
      return Promise.resolve(schema.parse({ items: [] }))
    })
    neverResolve()
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: '完了にする' }))

    const pending = await screen.findByRole('button', { name: '記録中...' })
    expect(pending).toBeDisabled()
    // 押していない「スキップ」は元の文言のまま(両方が同時に「記録中...」にならない)
    expect(screen.getByRole('button', { name: 'スキップ' })).toBeInTheDocument()
  })

  it('Phase 2 を完了する: 記録中は「完了中...」に変わる', async () => {
    mockMeAnd(phase2User(phase2Progress({ sectionA: 'completed', sectionB: 'completed' })), {
      kind: 'joined',
    })
    neverResolve()
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Phase 2 を完了する' }))

    const pending = await screen.findByRole('button', { name: '完了中...' })
    expect(pending).toBeDisabled()
  })
})
