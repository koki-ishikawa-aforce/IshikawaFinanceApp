import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { BalanceFreshnessCard, FreshnessBadge } from '../BalanceFreshness'
import { BalanceFreshnessItemWireSchema } from '@/lib/api-schemas'

const okItem = BalanceFreshnessItemWireSchema.parse({
  accountId: 'ACC_OK',
  displayName: '楽天銀行',
  lastUpdatedAt: '2026-07-20T00:00:00.000Z',
  daysSinceLastUpdate: 4,
  status: 'ok',
})

const alertItem = BalanceFreshnessItemWireSchema.parse({
  accountId: 'ACC_ALERT',
  displayName: 'ゆうちょ銀行',
  lastUpdatedAt: '2026-06-16T00:00:00.000Z',
  daysSinceLastUpdate: 40,
  status: 'alert',
})

describe('FreshnessBadge', () => {
  it('鮮度アラートのときだけ「N日未更新」を出す', () => {
    render(<FreshnessBadge freshness={alertItem} />)
    expect(screen.getByText('40日未更新')).toBeInTheDocument()
  })

  it('鮮度OK では何も出さない（更新済みの口座に警告を出さない）', () => {
    const { container } = render(<FreshnessBadge freshness={okItem} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('鮮度が未取得（undefined）でも何も出さない', () => {
    const { container } = render(<FreshnessBadge freshness={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })
})

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/** fetch をスタブして `/api/dashboard/balance-freshness` の応答を差し替える */
function stubFetch(response: { ok: boolean; body?: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      response.ok
        ? new Response(JSON.stringify(response.body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        : new Response('boom', { status: 500 }),
    ),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('BalanceFreshnessCard', () => {
  it('鮮度アラートの口座には「N日未更新」が付き、鮮度OK の口座には付かない', async () => {
    stubFetch({ ok: true, body: { items: [okItem, alertItem] } })
    render(<BalanceFreshnessCard />, { wrapper })

    expect(await screen.findByText('40日未更新')).toBeInTheDocument()
    expect(screen.getByText('楽天銀行')).toBeInTheDocument()
    expect(screen.queryByText('4日未更新')).not.toBeInTheDocument()
  })

  it('対象口座が 0 件なら、追加すれば埋まることを案内する', async () => {
    stubFetch({ ok: true, body: { items: [] } })
    render(<BalanceFreshnessCard />, { wrapper })

    expect(
      await screen.findByText('設定から別銀行貯蓄口座を追加すると、ここに更新状況が出ます'),
    ).toBeInTheDocument()
  })

  it('取得に失敗したらエラーと再読み込み手段を出す', async () => {
    stubFetch({ ok: false })
    render(<BalanceFreshnessCard />, { wrapper })

    expect(await screen.findByText('更新状況を取得できませんでした')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeInTheDocument()
  })

  it('入れ替わる領域が支援技術に通知される（role="status"）', async () => {
    stubFetch({ ok: true, body: { items: [alertItem] } })
    render(<BalanceFreshnessCard />, { wrapper })

    expect(await screen.findByText('40日未更新')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
