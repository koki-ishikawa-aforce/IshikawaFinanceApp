/**
 * はじめての設定画面の読み込み中・エラー表示（#497）の結線を固定する。
 *
 * この画面だけ、取得中は何も描かず（真っ白のまま待たされる）、エラーは独自の注意書きで
 * 出していた。他画面と同じ共通部品（LoadingState / ErrorState）を通すことで、
 * 待ち時間に画面が空にならないことと、失敗が画面読み上げソフトへ届くことの両方が要る。
 * どちらも画面の結線にしか現れないため、ここで検証する。
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
  })

  it('読み込み中は画面読み上げソフトへ伝わる（他画面と同じ扱い）', async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path === '/api/me') return Promise.resolve({ viewerId: 'U_HONEY', role: 'honey' })
      return new Promise(() => {})
    })
    renderPage()

    const loading = await screen.findByText('読み込み中...')
    expect(loading).toHaveAttribute('role', 'status')
  })

  it('取得に失敗したら、理由を読み上げに載せて再読み込みの手段を出す', async () => {
    apiFetch.mockImplementation((path: string, schema: { parse: (input: unknown) => unknown }) => {
      if (path === '/api/me') return Promise.resolve({ viewerId: 'U_HONEY', role: 'honey' })
      if (path === '/api/onboarding/me') {
        return Promise.reject(new ApiError(500, 'サーバーエラーが発生しました'))
      }
      return Promise.resolve(schema.parse({}))
    })
    renderPage()

    const message = await screen.findByText('サーバーエラーが発生しました')
    // 失敗はその場で気づけないとやり直せないため、割り込んで読み上げられる指定にする
    expect(message).toHaveAttribute('role', 'alert')
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeInTheDocument()
  })

  it('操作が失敗したときも、その操作の直下に読み上げ付きで理由を出す', async () => {
    apiFetch.mockImplementation((path: string, schema: { parse: (input: unknown) => unknown }) => {
      if (path === '/api/me') return Promise.resolve({ viewerId: 'U_HONEY', role: 'honey' })
      if (path === '/api/onboarding/me') return Promise.resolve(schema.parse(meResponse()))
      return Promise.resolve(schema.parse({}))
    })
    apiMutate.mockRejectedValue(new ApiError(500, 'ニックネームを保存できませんでした'))
    renderPage()

    await userEvent.type(await screen.findByPlaceholderText('例: はにー'), 'はにー')
    await userEvent.click(screen.getByRole('button', { name: '決定して次へ' }))

    const message = await screen.findByText('ニックネームを保存できませんでした')
    expect(message).toHaveAttribute('role', 'alert')
  })
})
