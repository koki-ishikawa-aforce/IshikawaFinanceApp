/**
 * 残高画面のテスト。押さえているのは 2 つ。
 *
 * - 口座残高カードは、取得中 / エラー / 一覧 が入れ替わる領域を常時マウントの
 *   `role="status"` で包んでいる。中の表示が自前で live region を作ると同じ文言が
 *   二重に読み上げられるため、その入れ子が無いことを固定する
 * - 画面上部の資産合計カードの呼称と金額表記。VRT の基準画像を撮り直すだけでは、
 *   呼称や表記が変わったことを止められない（#366）
 */
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BalancesPage from '../page'

const apiFetch = vi.fn()

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client')
  return {
    ...actual,
    apiFetch: (path: string, schema: { parse: (input: unknown) => unknown }) =>
      apiFetch(path, schema),
  }
})

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <BalancesPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  apiFetch.mockReset()
})

/** 「口座残高」の見出しを持つカード（入れ替わる領域を包む器がここにある） */
function balanceCard(): HTMLElement {
  const heading = screen.getByText('口座残高')
  const card = heading.parentElement
  if (card === null) throw new Error('口座残高カードが見つからない')
  return card
}

/** 資産合計カードの応答。金額はテストで読む値をそのまま置く */
function assetTotalResponse(): unknown {
  return {
    asOf: '2026-08-23',
    smbcBalance: 1500000,
    otherSavingsBalance: 2000000,
    nisaContributionAccumulated: 1200000,
    cardUnpaidTotal: 120000,
    total: 4580000,
  }
}

describe('残高画面の資産合計カード', () => {
  it('呼称は「資産合計」で、金額は 3 桁区切り + 「円」で出す', async () => {
    // 呼称はドメイン用語（docs/domain/08d）に合わせる。「総資産」に戻すと画面と用語がずれる
    apiFetch.mockImplementation((path: string) =>
      path === '/api/balances/total'
        ? Promise.resolve(assetTotalResponse())
        : Promise.reject(new Error('この検証では使わない')),
    )
    renderPage()

    const label = await screen.findByText('資産合計')
    const hero = label.parentElement
    if (hero === null) throw new Error('資産合計カードが見つからない')
    expect(within(hero).getByText('4,580,000円')).toBeInTheDocument()
    expect(within(hero).getByText('SMBC 1,500,000円')).toBeInTheDocument()
    expect(within(hero).getByText('貯蓄 2,000,000円')).toBeInTheDocument()
    expect(within(hero).getByText('NISA 1,200,000円')).toBeInTheDocument()
    // 未払いは差し引くぶんなので符号を前に置く
    expect(within(hero).getByText('未払い -120,000円')).toBeInTheDocument()
  })

  it('取得できていないうちは資産合計カードを出さない', () => {
    apiFetch.mockReturnValue(new Promise(() => {}))
    renderPage()

    expect(screen.queryByText('資産合計')).toBeNull()
  })
})

describe('残高画面の口座残高カード', () => {
  it('一覧の取得に失敗しても、通知は器ひとつだけで二重に読み上げない', async () => {
    apiFetch.mockRejectedValue(new Error('boom'))
    renderPage()

    expect(await screen.findByText('残高一覧の取得に失敗しました')).toBeInTheDocument()
    // 器が role="status" のため、中のエラーは alert を作らず polite で通知される
    expect(within(balanceCard()).queryByRole('alert')).toBeNull()
    expect(within(balanceCard()).getAllByRole('status')).toHaveLength(1)
  })

  it('取得中も、通知は器ひとつだけで「読み込み中...」を伝える', () => {
    apiFetch.mockReturnValue(new Promise(() => {}))
    renderPage()

    const statuses = within(balanceCard()).getAllByRole('status')
    expect(statuses).toHaveLength(1)
    expect(statuses[0]).toHaveTextContent('読み込み中...')
  })
})
