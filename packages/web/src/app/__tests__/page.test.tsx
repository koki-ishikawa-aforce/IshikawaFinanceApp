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
    // 閲覧者の役割(#597)・相手のニックネーム取得(#596)は本テストの主題ではないため、
    // 常に解決済みで返す(役割・ニックネームのゲート自体は別の describe で検証する)
    if (path === '/api/me') {
      return Promise.resolve({ viewerId: 'U_TEST', role: 'honey' })
    }
    if (path === '/api/settings/spouse-profile') {
      return Promise.resolve({ profile: { nickname: null } })
    }
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
    // kpis / breakdown に加え、閲覧者の役割(#597)・相手のニックネーム取得(#596)も
    // 初回マウントで走る
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(4))

    respond({ kpis: kpisResponse(), breakdown: breakdownResponse() })
    await user.click(screen.getByRole('button', { name: '再読み込み' }))

    // 押した直後も、取り直しが終わったあとも、成功している KPI は出たまま
    expect(screen.getByText('2,450,000円')).toBeInTheDocument()
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(5))
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

/**
 * 閲覧者の役割・相手のニックネームの応答をまとめて差し替える。役割・ニックネームは
 * 相手の呼称の根拠になるため、既定では解決済みにする(未解決・失敗は個別に指定)。
 * kpis・breakdown は常に成功で固定し、相手の個人費行の表示だけを見る。
 */
function mockDashboard(
  role: 'honey' | 'darling' | 'pending' | 'error' = 'darling',
  nickname: string | null | 'pending' = null,
): void {
  apiFetch.mockImplementation((path: string) => {
    if (path === '/api/me') {
      if (role === 'pending') return new Promise(() => {})
      if (role === 'error') return Promise.reject(new Error('boom'))
      return Promise.resolve({ viewerId: 'U_TEST', role })
    }
    if (path === '/api/settings/spouse-profile') {
      if (nickname === 'pending') return new Promise(() => {})
      return Promise.resolve({ profile: { nickname } })
    }
    if (path.includes('/api/dashboard/kpis')) {
      return Promise.resolve(DashboardKpisViewSchema.parse(kpisResponse()))
    }
    if (path.includes('/api/dashboard/category-breakdown')) {
      return Promise.resolve(CategoryBreakdownViewSchema.parse(breakdownResponse()))
    }
    return new Promise(() => {})
  })
}

describe('相手の個人費行', () => {
  it('本人の役割が確定していれば、相手の呼び名で個人費の合計を出す(#597)', async () => {
    mockDashboard('darling')
    renderPage()

    expect(await screen.findByText(/Honeyの個人費（合計のみ）/)).toBeInTheDocument()
  })

  it('honey の画面では相手が Darling になる', async () => {
    mockDashboard('honey')
    renderPage()

    expect(await screen.findByText(/Darlingの個人費（合計のみ）/)).toBeInTheDocument()
  })

  it('相手のニックネームが取れていれば、ロール名の代わりにニックネームで表示する', async () => {
    mockDashboard('darling', 'ななみ')
    renderPage()

    expect(await screen.findByText(/ななみの個人費（合計のみ）/)).toBeInTheDocument()
    expect(screen.queryByText(/Honeyの個人費（合計のみ）/)).not.toBeInTheDocument()
  })

  it('相手のニックネームが確定するまで相手の個人費行を描かない', async () => {
    // ロール名で仮描画してからニックネームに差し替えると、確定前の既定値を出す
    // 役割確定ゲートと同じ理由で不適切(usability 7-2)
    mockDashboard('darling', 'pending')
    renderPage()

    await screen.findByText('資産合計')
    expect(screen.queryByText(/個人費（合計のみ）/)).toBeNull()
  })

  it('閲覧者の役割が確定するまで相手の個人費行を描かない(#597)', async () => {
    // 既定値(darling)で描くと、honey の利用者に「Honeyの…」と自分の名前が付いた
    // 相手の金額が一瞬出てから差し替わる(usability.md 7-2)
    mockDashboard('pending')
    renderPage()

    await screen.findByText('資産合計')
    expect(screen.queryByText(/個人費（合計のみ）/)).toBeNull()
  })

  it('閲覧者の役割を取れなければ、相手の名前を推測せず再試行を出す(#597)', async () => {
    mockDashboard('error')
    renderPage()

    expect(await screen.findByText('相手の個人費の合計は表示できませんでした')).toBeInTheDocument()
    expect(screen.queryByText(/個人費（合計のみ）/)).toBeNull()
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeInTheDocument()
  })
})
