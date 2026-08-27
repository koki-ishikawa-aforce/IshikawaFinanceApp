/**
 * 取引を手で追加するとき、発生日の初期値が「表示中の月が当月なら今日、それ以外の月なら
 * その月の 1 日」になっていることを固定する。
 *
 * 当月の判定も「今日」も `now()`(`src/lib/now.ts`)から取る。ここが端末の時計を直接
 * 読む形に戻ると、見た目の自動チェックで日時を固定してもこの画面だけ実時刻で描かれ、
 * 撮影のたびに違う日付が入った基準画像ができる(#506)。
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CategoryListWireSchema,
  ExpenseTypeListWireSchema,
  TransactionListWireSchema,
  UnclassifiedSummaryWireSchema,
} from '@/lib/api-schemas'
import { MOCK_NOW } from '@/mocks/clock'

const apiMock = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  apiMutate: vi.fn(),
}))
vi.mock('@/lib/api-client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>()
  return { ...actual, ...apiMock }
})

/** 表示中の月。テストごとに差し替える */
const search = vi.hoisted(() => ({ query: 'month=2026-07' }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search.query),
}))

const TransactionsPage = (await import('../page')).default

function respondEmpty(): void {
  apiMock.apiFetch.mockImplementation((path: string) => {
    if (path.startsWith('/api/transactions/unclassified-summary')) {
      return Promise.resolve(UnclassifiedSummaryWireSchema.parse({ count: 0, recentIds: [] }))
    }
    if (path.startsWith('/api/transactions')) {
      return Promise.resolve(TransactionListWireSchema.parse([]))
    }
    if (path.startsWith('/api/categories')) {
      return Promise.resolve(CategoryListWireSchema.parse({ items: [] }))
    }
    return Promise.resolve(ExpenseTypeListWireSchema.parse({ items: [] }))
  })
}

/** 「取引を追加」を押してモーダルを開く */
async function openCreateModal(): Promise<HTMLElement> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <TransactionsPage />
    </QueryClientProvider>,
  )
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '取引を追加' }))
  return await screen.findByRole('dialog', { name: '取引を追加' })
}

describe('取引を追加するときの発生日の初期値', () => {
  beforeEach(() => {
    apiMock.apiFetch.mockReset()
    apiMock.apiMutate.mockReset()
    respondEmpty()
    // 「今」を 2026-07-24 に固定する(モック起動モードでのみ効く経路)
    vi.stubEnv('NEXT_PUBLIC_MOCK', '1')
    vi.stubEnv('NEXT_PUBLIC_MOCK_NOW', MOCK_NOW)
  })

  it('表示中の月が当月なら今日が入る', async () => {
    search.query = 'month=2026-07'

    const dialog = await openCreateModal()

    expect(within(dialog).getByDisplayValue('2026-07-24')).toBeInTheDocument()
  })

  // 当月以外を開いているのに「今日」を入れると、保存した取引が表示中の月から消える
  it('表示中の月が当月でなければ、その月の 1 日が入る', async () => {
    search.query = 'month=2026-05'

    const dialog = await openCreateModal()

    expect(within(dialog).getByDisplayValue('2026-05-01')).toBeInTheDocument()
  })

  // 端末の時間帯設定によらず「今日」は JST の暦日で決まる(#639)。MOCK_NOW(JST 7/24 12:00)は
  // ロサンゼルス(UTC-7)では 7/23 のままなので、端末時間帯まかせだと日付が 1 日ずれる
  it('端末の時間帯設定によらず JST の今日が入る', async () => {
    vi.stubEnv('TZ', 'America/Los_Angeles')
    search.query = 'month=2026-07'

    const dialog = await openCreateModal()

    expect(within(dialog).getByDisplayValue('2026-07-24')).toBeInTheDocument()
  })
})
