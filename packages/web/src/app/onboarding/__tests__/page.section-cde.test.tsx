/**
 * はじめての設定の Section C / D / E（カテゴリ・経費種別・月次上限の確認）の結線を固定する。
 *
 * この 3 つは「用意済みの設定に目を通した」ことを記録するだけの任意の手順（論点8）。
 * 記録が進捗表示に現れること、未確認のままでも設定を完了できること、SectionB 完了前は
 * 確認できないことが値打ちのため、画面の結線として検証する。
 */
import { render, screen, waitFor, within } from '@testing-library/react'
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

type ConfirmationKind = 'unconfirmed' | 'confirmed' | 'edited' | 'changed'

/** Phase2 進行中のユーザー。SectionA は常に完了済みで、B と C/D/E の状態を差し替えられる */
function appUser(options: {
  sectionB: 'not_started' | 'completed'
  sectionC?: ConfirmationKind
  sectionD?: ConfirmationKind
  sectionE?: ConfirmationKind
}): unknown {
  const at = '2026-02-01T00:00:00.000Z'
  return {
    kind: 'phase2_in_progress',
    common: {
      userId: 'U_HONEY',
      role: 'honey',
      nickname: 'はにー',
      firstRegisteredAt: '2026-01-01T00:00:00.000Z',
      lineOperationSettings: {
        friendAdd: { kind: 'added' },
        notificationActivation: { kind: 'activated' },
      },
    },
    progress: {
      sectionA: {
        kind: 'completed',
        tokenStoreRef: '/warimaru/gmail/honey/token',
        completedAt: at,
      },
      sectionB:
        options.sectionB === 'completed'
          ? {
              kind: 'completed',
              initialBalanceRef: {
                smbcAccountId: '01ACC00000000000000000SMBC',
                otherSavingsAccountId: '01ACC0000000000000000BANK2',
                nisaAccountId: '01ACC00000000000000000N1SA',
              },
              completedAt: at,
            }
          : { kind: 'not_started' },
      sectionC: { kind: options.sectionC ?? 'unconfirmed', confirmedAt: at },
      sectionD: { kind: options.sectionD ?? 'unconfirmed', confirmedAt: at },
      sectionE: { kind: options.sectionE ?? 'unconfirmed', confirmedAt: at },
      sectionF: { kind: 'not_started' },
    },
  }
}

let currentUser: unknown = appUser({ sectionB: 'completed' })

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
  currentUser = appUser({ sectionB: 'completed' })
  apiFetch.mockImplementation((path: string, schema: { parse: (input: unknown) => unknown }) => {
    if (path === '/api/me') return Promise.resolve({ viewerId: 'U_HONEY', role: 'honey' })
    if (path === '/api/onboarding/me') {
      return Promise.resolve(
        schema.parse({ user: currentUser, sharedTalkRoom: { kind: 'joined' } }),
      )
    }
    if (path.startsWith('/api/imports/status')) {
      return Promise.resolve(schema.parse({ completion: null }))
    }
    return Promise.resolve(schema.parse({ items: [] }))
  })
})

/**
 * セクションの行を名前で引く。3 行は同じ操作名（中身を見る / 確認しました）を持つため、
 * 行の名前で絞らないと「月次上限の行を押したのに C が飛ぶ」取り違えを見逃す。
 */
async function sectionRow(name: string): Promise<HTMLElement> {
  return screen.findByRole('group', { name })
}

/** 指定セクションの確認ボタン */
async function confirmButtonOf(name: string): Promise<HTMLElement> {
  return within(await sectionRow(name)).getByRole('button', { name: '確認しました' })
}

/** 確認を促している（＝未確認の）セクションの数 */
async function confirmButtons(): Promise<HTMLElement[]> {
  return screen.findAllByRole('button', { name: '確認しました' })
}

describe('Section C / D / E の確認', () => {
  it('確認を押すと、押したセクションの識別を添えて記録を送る', async () => {
    apiMutate.mockImplementation((_path, _options, schema: { parse: (i: unknown) => unknown }) =>
      Promise.resolve(
        schema.parse({ user: appUser({ sectionB: 'completed', sectionC: 'confirmed' }) }),
      ),
    )
    renderPage()

    await userEvent.click(await confirmButtonOf('カテゴリの確認'))

    await waitFor(() => expect(apiMutate).toHaveBeenCalledTimes(1))
    expect(apiMutate.mock.calls[0]?.[0]).toBe('/api/onboarding/phase2/section-confirmation')
    expect(apiMutate.mock.calls[0]?.[1]?.method).toBe('PUT')
    expect(apiMutate.mock.calls[0]?.[1]?.body).toEqual({ section: 'section_c' })
  })

  it('D・E もそれぞれの識別で記録される（3 つが取り違えられない）', async () => {
    apiMutate.mockImplementation((_path, _options, schema: { parse: (i: unknown) => unknown }) =>
      Promise.resolve(schema.parse({ user: currentUser })),
    )
    renderPage()

    await userEvent.click(await confirmButtonOf('経費種別の確認'))
    await waitFor(() => expect(apiMutate).toHaveBeenCalledTimes(1))
    expect(apiMutate.mock.calls[0]?.[1]?.body).toEqual({ section: 'section_d' })

    await userEvent.click(await confirmButtonOf('月次上限の確認'))
    await waitFor(() => expect(apiMutate).toHaveBeenCalledTimes(2))
    expect(apiMutate.mock.calls[1]?.[1]?.body).toEqual({ section: 'section_e' })
  })

  it('確認を記録すると進捗表示が「確認済み」に変わり、確認ボタンは消える', async () => {
    apiMutate.mockImplementation((_path, _options, schema: { parse: (i: unknown) => unknown }) => {
      currentUser = appUser({ sectionB: 'completed', sectionC: 'confirmed' })
      return Promise.resolve(schema.parse({ user: currentUser }))
    })
    renderPage()

    await userEvent.click(await confirmButtonOf('カテゴリの確認'))

    const row = await sectionRow('カテゴリの確認')
    await waitFor(() => expect(within(row).getByText('確認済み')).toBeInTheDocument())
    expect(within(row).queryByRole('button', { name: '確認しました' })).toBeNull()
    // C だけが確認済みになり、D・E は未確認のまま残る
    expect(await confirmButtons()).toHaveLength(2)
  })

  it('マスタを編集済み・変更済みのセクションは、確認を促さない', async () => {
    currentUser = appUser({ sectionB: 'completed', sectionC: 'edited', sectionE: 'changed' })
    renderPage()

    expect(await screen.findByText('編集済み')).toBeInTheDocument()
    expect(screen.getByText('変更済み')).toBeInTheDocument()
    expect(await confirmButtons()).toHaveLength(1)
  })

  it('SectionB の完了前は確認できない（論点8: 順序強制）', async () => {
    currentUser = appUser({ sectionB: 'not_started' })
    renderPage()

    const blocked = await screen.findAllByRole('button', { name: 'B の完了後に確認できます' })
    expect(blocked).toHaveLength(3)
    for (const button of blocked) expect(button).toBeDisabled()

    await userEvent.click(blocked[0]!)
    expect(apiMutate).not.toHaveBeenCalled()
  })

  it('C・D・E が未確認のままでも設定を完了できる（論点8: 確認は任意）', async () => {
    renderPage()

    expect(await screen.findAllByText('未確認')).toHaveLength(3)
    // 未確認を理由に完了を塞がない。将来うっかり必須化されたらこのテストが落ちる
    const complete = await screen.findByRole('button', { name: 'Phase 2 を完了する' })
    expect(complete).toBeEnabled()
  })

  it('記録に失敗したときは、押したセクションの下にだけ次の行動を案内する', async () => {
    // 通信断では fetch の英語メッセージがそのまま来る。それを見せずに行動で締める
    apiMutate.mockRejectedValue(new TypeError('Failed to fetch'))
    renderPage()

    await userEvent.click(await confirmButtonOf('カテゴリの確認'))

    const row = await sectionRow('カテゴリの確認')
    const note = await within(row).findByText(/確認を記録できませんでした/)
    expect(note.textContent).toContain('もう一度')
    expect(screen.queryByText(/Failed to fetch/)).toBeNull()
    // 失敗はその場で気づけないとやり直せない（使用性 8-4）
    expect(note.closest('[role="alert"]')).not.toBeNull()
    // 案内は押した行にだけ出し、失敗しても他のセクションの確認は続けられる
    expect(screen.getAllByText(/確認を記録できませんでした/)).toHaveLength(1)
    expect(await confirmButtons()).toHaveLength(3)
  })

  it('記録できた回は、結果が読み上げに載る（押したボタンが消えるため）', async () => {
    apiMutate.mockImplementation((_path, _options, schema: { parse: (i: unknown) => unknown }) => {
      currentUser = appUser({ sectionB: 'completed', sectionC: 'confirmed' })
      return Promise.resolve(schema.parse({ user: currentUser }))
    })
    renderPage()

    await userEvent.click(await confirmButtonOf('カテゴリの確認'))

    const note = await screen.findByText(/カテゴリの確認を記録しました/)
    expect(note.closest('[role="status"]')).not.toBeNull()
  })

  it('セクションごとに行の名前が付き、同名の操作が並んでも区別できる', async () => {
    renderPage()

    for (const name of ['カテゴリの確認', '経費種別の確認', '月次上限の確認']) {
      const row = await sectionRow(name)
      expect(within(row).getByRole('button', { name: '確認しました' })).toBeInTheDocument()
      expect(within(row).getByRole('link', { name: '中身を見る' })).toBeInTheDocument()
    }
  })

  it('記録中は同じセクションを押し直せない（二重に記録しない）', async () => {
    apiMutate.mockImplementation(() => new Promise(() => undefined))
    renderPage()

    await userEvent.click(await confirmButtonOf('カテゴリの確認'))

    const row = await sectionRow('カテゴリの確認')
    const pending = within(row).getByRole('button', { name: '記録中...' })
    expect(pending).toBeDisabled()
    await userEvent.click(pending)
    expect(apiMutate).toHaveBeenCalledTimes(1)
  })
})
