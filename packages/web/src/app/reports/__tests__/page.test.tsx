/**
 * 不完全月（運用開始月など、月の一部の期間しか集計できていない月）のレポートには
 * 注意書きが出る。同じ判定で LINE のサマリにも注意書きが出るため（#442-A）、
 * 画面側だけが静かに出なくなると、画面と LINE で同じ月の見え方が食い違う。
 */
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReportsPage from '../page'

const apiFetch = vi.fn()

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client')
  return {
    ...actual,
    apiFetch: (path: string, schema: { parse: (input: unknown) => unknown }) =>
      apiFetch(path, schema),
  }
})

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('month=2026-07'),
}))

function reportResponse(overrides: Record<string, unknown> = {}): unknown {
  return {
    status: 'csv_confirmed',
    common: {
      monthlyReportId: 'MR_TEST_001',
      targetYearMonth: '2026-07',
      householdCategoryTotals: [{ categoryId: '01HQ8ZKJ9M3N4P5Q6R7S8T9VWX', total: 98000 }],
      personalTotalHoney: 72000,
      personalTotalDarling: 86000,
      businessExpenseTotalSelf: 15000,
      nisaContributionAccumulated: 1200000,
      balanceTrend: {
        smbcBalanceTrend: [],
        otherSavingsBalanceTrend: [],
        nisaContributionTrend: [],
        cardUnpaidTrend: [],
      },
      ...overrides,
    },
    csvConfirmedAt: '2026-08-01T10:00:00.000Z',
    finalizedAt: null,
    unapprovedTransfers: null,
  }
}

/**
 * レポート本体とカテゴリ名の 2 本のリクエストに、パスで出し分けて答える。
 * 応答は本物の Wire スキーマに通す（日付の変換など、画面が前提にしている加工を素通りさせない）。
 */
function respondWith(report: unknown): void {
  apiFetch.mockImplementation((path: string, schema: { parse: (input: unknown) => unknown }) =>
    Promise.resolve(schema.parse(path.startsWith('/api/monthly-reports') ? report : { items: [] })),
  )
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ReportsPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  apiFetch.mockReset()
})

describe('月次レポート画面の不完全月の注意書き', () => {
  it('不完全月のレポートには注意書きを出す', async () => {
    respondWith(reportResponse({ isIncompleteMonth: true }))
    renderPage()

    expect(await screen.findByText('データが不完全な月です')).toBeInTheDocument()
  })

  it('フラグが付いていない通常の月には注意書きを出さない', async () => {
    respondWith(reportResponse())
    renderPage()

    // 注意書き以外が描かれるのを待ってから、注意書きだけが無いことを確かめる
    expect(await screen.findByText('世帯支出（カテゴリ別）')).toBeInTheDocument()
    expect(screen.queryByText('データが不完全な月です')).toBeNull()
  })
})
