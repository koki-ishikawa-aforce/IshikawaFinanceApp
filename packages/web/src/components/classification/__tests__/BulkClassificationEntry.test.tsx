import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { YearMonth } from '@warimaru/domain'

const apiMock = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  apiMutate: vi.fn(),
}))
// ApiError は実物を使う（失敗の種類で文言を出し分けるため）
vi.mock('@/lib/api-client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>()
  return { ...apiMock, ApiError: actual.ApiError }
})

const { BulkClassificationEntry } = await import('../BulkClassificationEntry')
const { BulkClassificationSessionWireSchema } = await import('@/lib/api-schemas')

const MONTH = '2026-07' as YearMonth
const IMPORT_JOB_ID = '01JEEEEEEEEEEEEEEEEEEEEEE1'

/** 一覧のワイヤー形式（分類済み行と未分類行が混ざる） */
function listItem(id: string, merchantName: string, isUnclassified: boolean): unknown {
  return {
    transactionId: id,
    occurredAt: new Date('2026-07-10T00:00:00.000Z'),
    expenseClass: 'personal_darling',
    categoryId: null,
    categoryName: null,
    merchantName,
    amount: 1000,
    isUnclassified,
  }
}

function inProgressSession(targetIds: string[]): unknown {
  return BulkClassificationSessionWireSchema.parse({
    kind: 'in_progress',
    common: {
      bulkClassificationSessionId: 'BCS_1',
      userId: 'U_DARLING',
      trigger: {
        kind: 'single_correction',
        transactionId: targetIds[0],
        startedAt: '2026-07-24T00:00:00.000Z',
      },
      targets: targetIds.map(id => ({
        kind: 'unclassified',
        transactionId: id,
        merchantName: `店舗${id}`,
        reason: 'merchant_rule_unlearned',
        defaultExpenseClass: 'personal_darling',
      })),
    },
    startedAt: '2026-07-24T00:00:00.000Z',
    remainingCount: targetIds.length,
  })
}

function renderEntry(props: {
  unclassifiedCount?: number
  importJobId?: string | null
  onFilterUnclassified?: () => void
}): ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const element = (
    <QueryClientProvider client={client}>
      <BulkClassificationEntry
        month={MONTH}
        unclassifiedCount={props.unclassifiedCount ?? 3}
        importJobId={props.importJobId ?? null}
        onFilterUnclassified={props.onFilterUnclassified ?? vi.fn()}
      />
    </QueryClientProvider>
  )
  render(element)
  return element
}

/** 既定: 進行中セッション無し・未分類 2 件 + 分類済み 1 件 + マスタ */
beforeEach(() => {
  apiMock.apiFetch.mockImplementation((path: string) => {
    if (path.startsWith('/api/classification/bulk-sessions/current')) {
      return Promise.resolve({ session: null })
    }
    if (path.startsWith('/api/transactions?month=2026-07&isUnclassifiedOnly=true')) {
      return Promise.resolve([listItem('TX1', 'スーパーA', true), listItem('TX2', 'カフェB', true)])
    }
    if (path.startsWith('/api/transactions?month=2026-07')) {
      return Promise.resolve([
        listItem('TX1', 'スーパーA', true),
        listItem('TX2', 'カフェB', false),
      ])
    }
    if (path === '/api/categories') return Promise.resolve({ items: [] })
    if (path === '/api/expense-types') return Promise.resolve({ items: [] })
    throw new Error(`unexpected apiFetch: ${path}`)
  })
  apiMock.apiMutate.mockImplementation(() => Promise.resolve(inProgressSession(['TX1', 'TX2'])))
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('BulkClassificationEntry', () => {
  it('未分類が 0 件で進行中セッションも無ければ何も出さない', async () => {
    const { container } = render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <BulkClassificationEntry
          month={MONTH}
          unclassifiedCount={0}
          importJobId={null}
          onFilterUnclassified={vi.fn()}
        />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('未分類の件数を示し、押すと一覧を未分類のみに絞る', async () => {
    const user = userEvent.setup()
    const onFilterUnclassified = vi.fn()
    renderEntry({ unclassifiedCount: 3, onFilterUnclassified })

    await user.click(await screen.findByRole('button', { name: /未分類の取引が 3 件あります/ }))

    expect(onFilterUnclassified).toHaveBeenCalled()
  })

  it('開始時の対象は表示月の未分類取引だけ（分類済みは送らない）', async () => {
    const user = userEvent.setup()
    renderEntry({})

    await user.click(await screen.findByRole('button', { name: '未分類をまとめて分類する' }))

    await waitFor(() =>
      expect(apiMock.apiMutate).toHaveBeenCalledWith(
        '/api/classification/bulk-sessions',
        {
          method: 'POST',
          body: {
            trigger: { kind: 'single_correction', transactionId: 'TX1' },
            transactionIds: ['TX1', 'TX2'],
          },
        },
        expect.anything(),
      ),
    )
  })

  it('取込完了から来たときは CSV 取込起因で開始する', async () => {
    const user = userEvent.setup()
    renderEntry({ importJobId: IMPORT_JOB_ID })

    await user.click(await screen.findByRole('button', { name: '未分類をまとめて分類する' }))

    await waitFor(() =>
      expect(apiMock.apiMutate).toHaveBeenCalledWith(
        '/api/classification/bulk-sessions',
        expect.objectContaining({
          body: expect.objectContaining({
            trigger: { kind: 'csv_import', importJobId: IMPORT_JOB_ID },
          }),
        }),
        expect.anything(),
      ),
    )
  })

  it('進行中のセッションがあるときは開始せず、再開の導線を出す', async () => {
    apiMock.apiFetch.mockImplementation((path: string) => {
      if (path.startsWith('/api/classification/bulk-sessions/current')) {
        return Promise.resolve({ session: inProgressSession(['TX1', 'TX2']) })
      }
      if (path.startsWith('/api/transactions?month=2026-07')) {
        return Promise.resolve([
          listItem('TX1', 'スーパーA', true),
          listItem('TX2', 'カフェB', false),
        ])
      }
      if (path === '/api/categories') return Promise.resolve({ items: [] })
      if (path === '/api/expense-types') return Promise.resolve({ items: [] })
      throw new Error(`unexpected apiFetch: ${path}`)
    })
    renderEntry({})

    expect(await screen.findByRole('button', { name: 'まとめて分類を続ける' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '未分類をまとめて分類する' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText(/まとめて分類が途中のままです/)).toBeInTheDocument()
    expect(apiMock.apiMutate).not.toHaveBeenCalled()
  })

  it('再開したセッションは、もう分類した取引を対象から外す', async () => {
    const user = userEvent.setup()
    apiMock.apiFetch.mockImplementation((path: string) => {
      if (path.startsWith('/api/classification/bulk-sessions/current')) {
        return Promise.resolve({ session: inProgressSession(['TX1', 'TX2']) })
      }
      if (path.startsWith('/api/transactions?month=2026-07')) {
        // TX2 はセッション開始後に分類済みになった
        return Promise.resolve([
          listItem('TX1', 'スーパーA', true),
          listItem('TX2', 'カフェB', false),
        ])
      }
      if (path === '/api/categories') return Promise.resolve({ items: [] })
      if (path === '/api/expense-types') return Promise.resolve({ items: [] })
      throw new Error(`unexpected apiFetch: ${path}`)
    })
    renderEntry({})

    await user.click(await screen.findByRole('button', { name: 'まとめて分類を続ける' }))

    // 残っている 1 店舗だけが提示される
    expect(await screen.findByText('1 / 1 店舗（分類済み 0 件）')).toBeInTheDocument()
    expect(screen.getByText('店舗TX1')).toBeInTheDocument()
    expect(screen.queryByText('店舗TX2')).not.toBeInTheDocument()
  })

  it('進行中セッションの取得に失敗したら、開始させずに再試行手段を出す', async () => {
    apiMock.apiFetch.mockImplementation((path: string) => {
      if (path.startsWith('/api/classification/bulk-sessions/current')) {
        return Promise.reject(new Error('boom'))
      }
      return Promise.resolve([])
    })
    renderEntry({})

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'まとめて分類の状況を取得できませんでした。',
    )
    // 進行中セッションの有無が不明なまま開始すると必ず失敗するため、開始は出さない
    expect(
      screen.queryByRole('button', { name: '未分類をまとめて分類する' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeInTheDocument()
  })

  it('進行中セッションが理由で開始を拒否されたら、再開を促す文言を出す', async () => {
    const user = userEvent.setup()
    const { ApiError } = await import('@/lib/api-client')
    apiMock.apiMutate.mockRejectedValue(
      new ApiError(409, JSON.stringify({ error: '進行中の一括分類セッションが既に存在する' })),
    )
    renderEntry({})

    await user.click(await screen.findByRole('button', { name: '未分類をまとめて分類する' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'すでに始めているまとめて分類があります。画面を再読み込みして、続きをおえるかやめてからお試しください。',
    )
  })

  it('対象が 1 件も無くなっていたら、その状況を文言で伝える', async () => {
    const user = userEvent.setup()
    apiMock.apiFetch.mockImplementation((path: string) => {
      if (path.startsWith('/api/classification/bulk-sessions/current')) {
        return Promise.resolve({ session: null })
      }
      if (path.startsWith('/api/transactions?month=2026-07')) return Promise.resolve([])
      return Promise.resolve({ items: [] })
    })
    renderEntry({})

    await user.click(await screen.findByRole('button', { name: '未分類をまとめて分類する' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'この月に未分類の取引はありません。月を切り替えてお試しください。',
    )
    expect(apiMock.apiMutate).not.toHaveBeenCalled()
  })
})
