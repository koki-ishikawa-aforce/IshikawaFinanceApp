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
    expect(apiMutate.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: { kind: 'smbc_bank', initialBalance: 1500000 },
    })
  })

  it('残高が未入力・負の値のあいだは SMBC 銀行口座を登録できない', async () => {
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'SMBC銀行口座を追加' }))
    const submit = screen.getByRole('button', { name: '登録' })
    expect(submit).toBeDisabled()

    await userEvent.type(screen.getByLabelText('現在の残高（円、初期残高として登録）'), '-1')
    expect(submit).toBeDisabled()
  })

  it('三井住友カードは入力なしで登録できる（未払金は取込が積み上げる）', async () => {
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: '三井住友カードを追加' }))
    await userEvent.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(apiMutate).toHaveBeenCalledTimes(1))
    expect(apiMutate.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: { kind: 'mitsui_sumitomo_card' },
    })
  })
})
