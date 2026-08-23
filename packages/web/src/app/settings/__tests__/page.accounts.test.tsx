/**
 * 設定 > 口座タブの登録導線（#395）の結線を固定する。
 *
 * 本番で口座を作れる経路はこの画面だけで、ここから登録できない口座種別があると
 * はじめての設定（初期残高の登録）とメール取込の反映先が揃わない。登録できる種別と
 * 送る内容は画面の結線にしか現れないため、ここで検証する。
 */
import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from '../page'
import { ApiError } from '@/lib/api-client'

const apiFetch = vi.fn()
const apiMutate = vi.fn()

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('section=accounts'),
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

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

let registeredKinds: string[] = []

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  apiFetch.mockReset()
  apiMutate.mockReset()
  registeredKinds = []
  apiFetch.mockImplementation((path: string, schema: { parse: (input: unknown) => unknown }) => {
    if (path === '/api/me') return Promise.resolve({ viewerId: VIEWER_ID, role: 'honey' })
    if (path === '/api/accounts') {
      return Promise.resolve(
        schema.parse({ items: registeredKinds.map((kind, i) => ownAccount(kind, `ACC_${i + 1}`)) }),
      )
    }
    return Promise.resolve(schema.parse({ items: [] }))
  })
  apiMutate.mockImplementation((_path, _options, schema: { parse: (i: unknown) => unknown }) =>
    Promise.resolve(schema.parse({})),
  )
})

describe('設定 > 口座タブの登録導線', () => {
  it('口座が 1 つも無ければ、4 種すべてを追加できる', async () => {
    renderPage()

    for (const name of [
      'SMBC銀行口座を追加',
      '三井住友カードを追加',
      '別銀行貯蓄口座を追加',
      'NISA口座を追加',
    ]) {
      expect(await screen.findByRole('button', { name })).toBeInTheDocument()
    }
  })

  it('登録済みの種別は追加できない（同一ユーザー × 口座種別は 1 件）', async () => {
    registeredKinds = ['smbc_bank', 'mitsui_sumitomo_card']
    renderPage()

    expect(await screen.findByRole('button', { name: '別銀行貯蓄口座を追加' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'SMBC銀行口座を追加' })).toBeNull()
    expect(screen.queryByRole('button', { name: '三井住友カードを追加' })).toBeNull()
  })

  it('SMBC 銀行口座は入力した現在の残高を初期残高として登録する', async () => {
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'SMBC銀行口座を追加' }))
    await userEvent.type(screen.getByLabelText('現在の残高（円、初期残高として登録）'), '1500000')
    await userEvent.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(apiMutate).toHaveBeenCalledTimes(1))
    expect(apiMutate.mock.calls[0]?.[0]).toBe('/api/accounts')
    expect(apiMutate.mock.calls[0]?.[1]).toEqual({
      method: 'POST',
      body: { kind: 'smbc_bank', initialBalance: 1500000 },
    })
  })

  it('登録できたらモーダルが閉じ、一覧が取り直されて追加ボタンが消える', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'SMBC銀行口座を追加' }))
    await userEvent.type(screen.getByLabelText('現在の残高（円、初期残高として登録）'), '1500000')
    // 登録が通ったあとの一覧は登録済みを返す（サーバー状態が正）
    apiMutate.mockImplementation((_path, _options, schema: { parse: (i: unknown) => unknown }) => {
      registeredKinds = ['smbc_bank']
      return Promise.resolve(schema.parse({}))
    })

    await userEvent.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.queryByRole('button', { name: '登録' })).toBeNull())
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'SMBC銀行口座を追加' })).toBeNull(),
    )
  })

  it('登録に失敗したらモーダルは閉じず、次の行動が分かる文言を出す', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'SMBC銀行口座を追加' }))
    await userEvent.type(screen.getByLabelText('現在の残高（円、初期残高として登録）'), '1500000')
    apiMutate.mockRejectedValue(new ApiError(409, '{"error":"Conflict"}'))

    await userEvent.click(screen.getByRole('button', { name: '登録' }))

    const error = await screen.findByText(/すでに登録されています/)
    expect(error.closest('[role="alert"]')).not.toBeNull()
    // 応答本文をそのまま見せない
    expect(screen.queryByText(/Conflict/)).toBeNull()
    expect(screen.getByRole('button', { name: '登録' })).toBeEnabled()
  })

  it('残高が未入力のあいだは SMBC 銀行口座を登録できない', async () => {
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'SMBC銀行口座を追加' }))
    expect(screen.getByRole('button', { name: '登録' })).toBeDisabled()
  })

  it('負の値・小数のあいだは SMBC 銀行口座を登録できない', async () => {
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'SMBC銀行口座を追加' }))
    const amount = screen.getByLabelText('現在の残高（円、初期残高として登録）')
    await userEvent.type(amount, '-1')
    expect(amount).toHaveValue('-1')
    expect(screen.getByRole('button', { name: '登録' })).toBeDisabled()

    await userEvent.clear(amount)
    await userEvent.type(amount, '1000.5')
    expect(amount).toHaveValue('1000.5')
    expect(screen.getByRole('button', { name: '登録' })).toBeDisabled()
  })

  it('三井住友カードは入力なしで登録できる（未払金は取込が積み上げる）', async () => {
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: '三井住友カードを追加' }))
    await userEvent.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(apiMutate).toHaveBeenCalledTimes(1))
    expect(apiMutate.mock.calls[0]?.[1]).toEqual({
      method: 'POST',
      body: { kind: 'mitsui_sumitomo_card' },
    })
  })

  it('別銀行貯蓄口座は銀行名の前後の空白を落として送る（空欄のあいだは登録できない）', async () => {
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: '別銀行貯蓄口座を追加' }))
    expect(screen.getByRole('button', { name: '登録' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('銀行名'), '  楽天銀行  ')
    await userEvent.type(screen.getByLabelText('現在の残高（円、初期残高として登録）'), '500000')
    await userEvent.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(apiMutate).toHaveBeenCalledTimes(1))
    expect(apiMutate.mock.calls[0]?.[1]).toEqual({
      method: 'POST',
      body: { kind: 'other_savings', bankName: '楽天銀行', initialBalance: 500000 },
    })
  })

  it('NISA 口座はその他証券会社の名前の前後の空白を落として送る（未入力のあいだは登録できない）', async () => {
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'NISA口座を追加' }))
    await userEvent.selectOptions(screen.getByLabelText('証券会社'), 'other')
    await userEvent.type(screen.getByLabelText('積立累計（円、初期累計として登録）'), '200000')
    expect(screen.getByRole('button', { name: '登録' })).toBeDisabled()

    await userEvent.type(screen.getByLabelText('証券会社名'), '  マネックス証券  ')
    await userEvent.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(apiMutate).toHaveBeenCalledTimes(1))
    expect(apiMutate.mock.calls[0]?.[1]).toEqual({
      method: 'POST',
      body: {
        kind: 'nisa',
        brokerageName: { kind: 'other', customName: 'マネックス証券' },
        initialAccumulated: 200000,
      },
    })
  })

  it('口座の一覧を取得できないあいだは追加ボタンを出さない（重複登録に当てない）', async () => {
    apiFetch.mockImplementation((path: string, schema: { parse: (input: unknown) => unknown }) => {
      if (path === '/api/me') return Promise.resolve({ viewerId: VIEWER_ID, role: 'honey' })
      if (path === '/api/accounts') return Promise.reject(new ApiError(500, 'サーバーエラー'))
      return Promise.resolve(schema.parse({ items: [] }))
    })
    renderPage()

    expect(await screen.findByText('口座の取得に失敗しました')).toBeInTheDocument()
    for (const name of [
      'SMBC銀行口座を追加',
      '三井住友カードを追加',
      '別銀行貯蓄口座を追加',
      'NISA口座を追加',
    ]) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
  })
})
