/**
 * ダッシュボードは KPI とカテゴリ内訳を別々に取りに行く。片方が失敗したときに
 * その場で取り直せること（`docs/design/usability.md` 1-3）を結線として固定する。
 * 部品側（ErrorState）の単体テストでは、押したときに実際にそのデータを
 * 取り直すところまでは担保できないため（#366）。
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CategoryBreakdownViewSchema, DashboardKpisViewSchema } from '@warimaru/domain'
import DashboardPage from '../page'

const apiFetch = vi.fn()

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client')
  return {
    ...actual,
    apiFetch: (path: string, schema: { parse: (input: unknown) => unknown }) =>
      apiFetch(path, schema),
  }
})

function kpisResponse(): unknown {
  return {
    yearMonth: '2026-08',
    mode: 'household',
    currentMonthSpending: 123456,
    savingsBalance: 2000000,
    nisaContributionAccumulated: 500000,
    totalAssets: 2450000,
    spousePersonalTotal: 45000,
  }
}

function breakdownResponse(): unknown {
  return {
    yearMonth: '2026-08',
    mode: 'household',
    totalAmount: 100000,
    items: [
      {
        categoryId: '01HQ8ZKJ9M3N4P5Q6R7S8T9VWX',
        categoryName: '食費',
        total: 100000,
        count: 3,
        percentage: 100,
      },
    ],
  }
}

/**
 * パスで応答を振り分ける。KPI と内訳は別々のクエリなので、片方だけ失敗させられる。
 *
 * 応答は実際の画面と同じスキーマ(`@warimaru/domain`)に通してから返す。素通しにすると、
 * 画面が読む形と fixture がずれたことに気づけないまま緑になる
 */
function respond(options: { kpis?: unknown; breakdown?: unknown }): void {
  apiFetch.mockImplementation((path: string) => {
    const isKpis = path.includes('/api/dashboard/kpis')
    const value = isKpis ? options.kpis : options.breakdown
    if (value instanceof Error) return Promise.reject(value)
    const schema = isKpis ? DashboardKpisViewSchema : CategoryBreakdownViewSchema
    return Promise.resolve(schema.parse(value))
  })
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardPage />
    </QueryClientProvider>,
  )
}

describe('ダッシュボード', () => {
  beforeEach(() => {
    apiFetch.mockReset()
  })

  it('KPI の取得に失敗したら、再読み込みで取り直せる', async () => {
    const user = userEvent.setup()
    respond({ kpis: new Error('network unreachable'), breakdown: breakdownResponse() })
    renderPage()

    expect(await screen.findByText(/KPI の取得に失敗しました/)).toBeInTheDocument()

    respond({ kpis: kpisResponse(), breakdown: breakdownResponse() })
    await user.click(screen.getByRole('button', { name: '再読み込み' }))

    expect(await screen.findByText('資産合計')).toBeInTheDocument()
    expect(screen.queryByText(/KPI の取得に失敗しました/)).not.toBeInTheDocument()
  })

  it('カテゴリ内訳の取得に失敗したら、再読み込みで取り直せる', async () => {
    const user = userEvent.setup()
    respond({ kpis: kpisResponse(), breakdown: new Error('network unreachable') })
    renderPage()

    expect(await screen.findByText(/カテゴリ内訳の取得に失敗しました/)).toBeInTheDocument()

    respond({ kpis: kpisResponse(), breakdown: breakdownResponse() })
    await user.click(screen.getByRole('button', { name: '再読み込み' }))

    expect(await screen.findByRole('link', { name: /食費/ })).toBeInTheDocument()
    expect(screen.queryByText(/カテゴリ内訳の取得に失敗しました/)).not.toBeInTheDocument()
  })

  it('取り直すのは失敗したほうだけで、成功済みのデータを取り直さない', async () => {
    // 片方の失敗で画面全体を取り直すと、成功しているセクションまで一度消える（1-4）
    const user = userEvent.setup()
    respond({ kpis: kpisResponse(), breakdown: new Error('network unreachable') })
    renderPage()

    expect(await screen.findByText(/カテゴリ内訳の取得に失敗しました/)).toBeInTheDocument()
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2))

    respond({ kpis: kpisResponse(), breakdown: breakdownResponse() })
    await user.click(screen.getByRole('button', { name: '再読み込み' }))

    // 押した直後も、取り直しが終わったあとも、成功している KPI は出たまま
    expect(screen.getByText('2,450,000円')).toBeInTheDocument()
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(3))
    expect(await screen.findByRole('link', { name: /食費/ })).toBeInTheDocument()
    expect(screen.getByText('2,450,000円')).toBeInTheDocument()
    const paths = apiFetch.mock.calls.map(call => String(call[0]))
    expect(paths.filter(path => path.includes('/api/dashboard/kpis'))).toHaveLength(1)
  })

  it('取得に失敗していないときは再読み込みの手段を出さない', async () => {
    respond({ kpis: kpisResponse(), breakdown: breakdownResponse() })
    renderPage()

    expect(await screen.findByText('資産合計')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '再読み込み' })).toBeNull()
  })

  it('金額は 3 桁区切り + 「円」で表示する', async () => {
    respond({ kpis: kpisResponse(), breakdown: breakdownResponse() })
    renderPage()

    const hero = await screen.findByText('資産合計')
    expect(within(hero.parentElement as HTMLElement).getByText('2,450,000円')).toBeInTheDocument()
  })
})
