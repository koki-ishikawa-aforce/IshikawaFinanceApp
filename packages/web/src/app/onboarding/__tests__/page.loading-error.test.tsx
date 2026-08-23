/**
 * はじめての設定画面の読み込み中・エラー表示（#497）の結線を固定する。
 *
 * この画面だけ、取得中は何も描かず（真っ白のまま待たされる）、エラーは独自の注意書きで
 * 出していた。他画面と同じ共通部品（LoadingState / ErrorState）を通すことで、
 * 待ち時間に画面が空にならないことと、失敗が支援技術へ届くことの両方が要る。
 * どちらも画面の結線にしか現れないため、ここで検証する。
 */
import { render, screen, waitFor, within } from '@testing-library/react'
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

/** 登録済み・ニックネーム未設定（= ニックネームのステップに留まる） */
function meResponse(): unknown {
  return {
    user: {
      kind: 'phase1_completed',
      common: {
        userId: 'U_HONEY',
        role: 'honey',
        firstRegisteredAt: '2026-01-01T00:00:00.000Z',
      },
    },
    sharedTalkRoom: { kind: 'not_joined' },
  }
}

/** Phase2 完了済み（= 配偶者の完了待ちのステップに留まる） */
function spouseWaitResponse(): unknown {
  return {
    user: {
      kind: 'phase2_completed',
      common: {
        userId: 'U_HONEY',
        role: 'honey',
        nickname: 'はにー',
        firstRegisteredAt: '2026-01-01T00:00:00.000Z',
      },
    },
    sharedTalkRoom: {
      kind: 'joined',
      talkRoomId: 'room_001',
      joinedAt: '2026-01-01T00:00:00.000Z',
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

beforeEach(() => {
  apiFetch.mockReset()
  apiMutate.mockReset()
})

describe('はじめての設定の読み込み中・エラー', () => {
  it('取得が終わるまで「読み込み中...」を出す（真っ白なまま待たせない）', async () => {
    const pendingMe: { resolve: (() => void) | null } = { resolve: null }
    apiFetch.mockImplementation((path: string, schema: { parse: (input: unknown) => unknown }) => {
      if (path === '/api/me') return Promise.resolve({ viewerId: 'U_HONEY', role: 'honey' })
      if (path === '/api/onboarding/me') {
        return new Promise(resolve => {
          pendingMe.resolve = () => resolve(schema.parse(meResponse()))
        })
      }
      return Promise.resolve(schema.parse({}))
    })
    renderPage()

    // 取得中も画面の器（見出し）は出したまま、読み込み中を共通部品で示す
    expect(await screen.findByText('読み込み中...')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'はじめての設定' })).toBeInTheDocument()

    await waitFor(() => expect(pendingMe.resolve).not.toBeNull())
    pendingMe.resolve?.()

    // 取得が終われば読み込み中は消え、手順が出る
    await screen.findByRole('button', { name: '決定して次へ' })
    expect(screen.queryByText('読み込み中...')).toBeNull()
    // 失敗していないのにエラー表示が出ていない（ErrorState は常時マウントで、中身の有無で出し分ける）
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('再読み込みで立て直せる（押すと取り直して手順に戻る）', async () => {
    let attempts = 0
    apiFetch.mockImplementation((path: string, schema: { parse: (input: unknown) => unknown }) => {
      if (path === '/api/me') return Promise.resolve({ viewerId: 'U_HONEY', role: 'honey' })
      if (path === '/api/onboarding/me') {
        attempts += 1
        return attempts === 1
          ? Promise.reject(new ApiError(500, JSON.stringify({ error: 'Internal server error' })))
          : Promise.resolve(schema.parse(meResponse()))
      }
      return Promise.resolve(schema.parse({}))
    })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: '再読み込み' }))

    expect(await screen.findByRole('button', { name: '決定して次へ' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('画面全体のフォールバックには読み上げ領域を置かない（他画面のフォールバックと同じ扱い）', async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === '/api/me') return Promise.resolve({ viewerId: 'U_HONEY', role: 'honey' })
      return new Promise(() => {})
    })
    renderPage()

    // マウントと同時に現れる live region は通知が起きず、器の読み上げに重なるだけになる。
    // announce={false} を落とすとこの否定形が落ちる
    const loading = await screen.findByText('読み込み中...')
    expect(loading).not.toHaveAttribute('role')
  })

  it('取得に失敗したら、理由を支援技術に載せて再読み込みの手段を出す', async () => {
    apiFetch.mockImplementation((path: string, schema: { parse: (input: unknown) => unknown }) => {
      if (path === '/api/me') return Promise.resolve({ viewerId: 'U_HONEY', role: 'honey' })
      if (path === '/api/onboarding/me') {
        // 実 API が 500 で返す形（packages/api の error-handler）に合わせる
        return Promise.reject(new ApiError(500, JSON.stringify({ error: 'Internal server error' })))
      }
      return Promise.resolve(schema.parse({}))
    })
    renderPage()

    // 失敗はその場で気づけないとやり直せないため、割り込んで読み上げられる指定にする
    const message = await screen.findByRole('alert')
    // API のエラーボディ（{"error":"..."} の生 JSON）を流さず、利用者に読める固定文言を出す
    expect(message).toHaveTextContent('設定の状況を取得できませんでした')
    expect(message.textContent).not.toContain('Internal server error')
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeInTheDocument()
  })

  it('操作が失敗したときも、その操作の直下に読み上げ付きで理由を出す', async () => {
    apiFetch.mockImplementation((path: string, schema: { parse: (input: unknown) => unknown }) => {
      if (path === '/api/me') return Promise.resolve({ viewerId: 'U_HONEY', role: 'honey' })
      if (path === '/api/onboarding/me') return Promise.resolve(schema.parse(meResponse()))
      return Promise.resolve(schema.parse({}))
    })
    apiMutate.mockRejectedValue(
      new ApiError(500, JSON.stringify({ error: 'Internal server error' })),
    )
    renderPage()

    await userEvent.type(await screen.findByPlaceholderText('例: はにー'), 'はにー')
    await userEvent.click(screen.getByRole('button', { name: '決定して次へ' }))

    const message = await screen.findByRole('alert')
    expect(message).toHaveTextContent(
      'ニックネームを保存できませんでした。通信状況を確かめて、もう一度お試しください。',
    )
    expect(message.textContent).not.toContain('Internal server error')
  })

  it('配偶者の完了確認は、取得前に「待っています」と断定せず確認中を出す', async () => {
    const pendingSpouse: { resolve: (() => void) | null } = { resolve: null }
    apiFetch.mockImplementation((path: string, schema: { parse: (input: unknown) => unknown }) => {
      if (path === '/api/me') return Promise.resolve({ viewerId: 'U_HONEY', role: 'honey' })
      if (path === '/api/onboarding/me') return Promise.resolve(schema.parse(spouseWaitResponse()))
      if (path === '/api/onboarding/spouse-completion') {
        return new Promise(resolve => {
          pendingSpouse.resolve = () =>
            resolve(
              schema.parse({
                kind: 'awaiting_spouse',
                userId: 'U_HONEY',
                spouseUserId: 'U_DARLING',
                detectedAt: '2026-02-01T00:00:00.000Z',
              }),
            )
        })
      }
      return Promise.resolve(schema.parse({}))
    })
    renderPage()

    expect(await screen.findByText('配偶者の状況を確認しています...')).toBeInTheDocument()
    expect(screen.queryByText('配偶者の設定完了を待っています')).toBeNull()

    await waitFor(() => expect(pendingSpouse.resolve).not.toBeNull())
    pendingSpouse.resolve?.()

    expect(await screen.findByText('配偶者の設定完了を待っています')).toBeInTheDocument()
  })

  it('配偶者の完了確認は、押しても画面が変わらないため差し替わりを読み上げ領域に載せる', async () => {
    apiFetch.mockImplementation((path: string, schema: { parse: (input: unknown) => unknown }) => {
      if (path === '/api/me') return Promise.resolve({ viewerId: 'U_HONEY', role: 'honey' })
      if (path === '/api/onboarding/me') return Promise.resolve(schema.parse(spouseWaitResponse()))
      if (path === '/api/onboarding/spouse-completion') {
        return Promise.resolve(
          schema.parse({
            kind: 'awaiting_spouse',
            userId: 'U_HONEY',
            spouseUserId: 'U_DARLING',
            detectedAt: '2026-02-01T00:00:00.000Z',
          }),
        )
      }
      return Promise.resolve(schema.parse({}))
    })
    renderPage()

    await screen.findByText('配偶者の設定完了を待っています')
    const live = screen.getByRole('status')
    expect(within(live).getByText('配偶者の設定完了を待っています')).toBeInTheDocument()
    // 再試行の操作は読み上げ領域の外に置く（差し替わりのたびに読み上げへ混ざるのを避ける）
    expect(within(live).queryByRole('button', { name: '最新の状態を確認' })).toBeNull()
    expect(screen.getByRole('button', { name: '最新の状態を確認' })).toBeInTheDocument()
  })
})
