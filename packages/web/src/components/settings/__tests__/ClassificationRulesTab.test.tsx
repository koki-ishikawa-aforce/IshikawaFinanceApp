import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClassificationRulesTab } from '../ClassificationRulesTab'

const apiMock = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  apiMutate: vi.fn(),
}))

vi.mock('@/lib/api-client', () => apiMock)

/** サーバーの JSON 応答（Date は ISO 文字列）をそのまま模す。ワイヤースキーマの検証も通す */
const MERCHANT_RULES = {
  items: [
    {
      kind: 'active',
      common: { userId: 'U_ME', merchantName: 'ライフ 中目黒店' },
      categoryRef: { kind: 'learned', categoryId: 'CAT_FOOD' },
      expenseClassRef: { kind: 'learned', expenseClass: 'household' },
      expenseTypeRef: { kind: 'unlearned' },
      lastUpdatedAt: '2026-07-18T04:20:00.000Z',
    },
    {
      kind: 'disabled',
      common: { userId: 'U_ME', merchantName: 'セブンイレブン' },
      disabledAt: '2026-06-30T12:00:00.000Z',
    },
  ],
}

const AMAZON_RULES = {
  items: [
    {
      userId: 'U_ME',
      amazonProductKey: '技術書 / プログラミング',
      categoryRef: { kind: 'learned', categoryId: 'CAT_OTHER' },
      expenseClassRef: { kind: 'learned', expenseClass: 'business_expense' },
      expenseTypeRef: { kind: 'learned', expenseTypeId: 'ET_BOOKS' },
      lastUpdatedAt: '2026-07-12T09:00:00.000Z',
    },
  ],
}

const CATEGORIES = {
  items: [
    { kind: 'default', categoryId: 'CAT_FOOD', name: '食費', scope: { kind: 'household_shared' } },
    {
      kind: 'custom',
      categoryId: 'CAT_OTHER',
      name: 'その他',
      scope: { kind: 'household_shared' },
    },
  ],
}

const EXPENSE_TYPES = {
  items: [
    {
      kind: 'default',
      expenseTypeId: 'ET_BOOKS',
      name: '書籍代',
      scope: { kind: 'personal', userId: 'U_ME' },
    },
  ],
}

type Responder = (path: string) => unknown

/** 既定のレスポンス。パスごとに差し替えたいテストは overrides で上書きする */
function respondWith(overrides: Record<string, unknown | Error | Promise<never>> = {}): Responder {
  const table: Record<string, unknown> = {
    '/api/classification/merchant-rules': MERCHANT_RULES,
    '/api/classification/amazon-rules': AMAZON_RULES,
    '/api/categories': CATEGORIES,
    '/api/expense-types': EXPENSE_TYPES,
    ...overrides,
  }
  return path => table[path]
}

function mockFetch(responder: Responder): void {
  apiMock.apiFetch.mockImplementation(
    (path: string, schema: { parse: (i: unknown) => unknown }) => {
      const value = responder(path)
      if (value instanceof Error) return Promise.reject(value)
      if (value instanceof Promise) return value
      return Promise.resolve(schema.parse(value))
    },
  )
}

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ClassificationRulesTab />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  apiMock.apiFetch.mockReset()
  apiMock.apiMutate.mockReset()
  apiMock.apiMutate.mockResolvedValue(undefined)
})

describe('ClassificationRulesTab', () => {
  it('加盟店ルールと Amazon 商品ルールを、マスタ名に解決して一覧表示する', async () => {
    mockFetch(respondWith())
    renderTab()

    expect(await screen.findByText('ライフ 中目黒店')).toBeInTheDocument()
    expect(screen.getByText('技術書 / プログラミング')).toBeInTheDocument()
    // カテゴリ ID ではなくマスタ名で表示する
    expect(screen.getByText('食費')).toBeInTheDocument()
    expect(screen.getByText('書籍代')).toBeInTheDocument()
    expect(screen.queryByText('CAT_FOOD')).not.toBeInTheDocument()
    // 未学習の軸も落とさず表示する
    expect(screen.getAllByText('まだ覚えていません').length).toBeGreaterThan(0)
  })

  it('学習中と停止中を区別し、停止中の行には再開の操作だけを出す', async () => {
    mockFetch(respondWith())
    renderTab()

    const stoppedRow = (await screen.findByText('セブンイレブン')).closest('li')
    expect(stoppedRow).not.toBeNull()
    const stopped = within(stoppedRow as HTMLElement)
    expect(stopped.getByText('学習を停止中')).toBeInTheDocument()
    expect(
      stopped.getByRole('button', { name: 'セブンイレブンの学習を再開する' }),
    ).toBeInTheDocument()
    expect(
      stopped.queryByRole('button', { name: 'セブンイレブンの学習を止める' }),
    ).not.toBeInTheDocument()
  })

  it('学習ルールが 1 件も無いとき、何をすれば埋まるかを示す空状態を出す', async () => {
    mockFetch(respondWith({ '/api/classification/merchant-rules': { items: [] } }))
    renderTab()

    expect(
      await screen.findByText(
        '覚えている加盟店はまだありません。取引一覧で分類すると、その加盟店の分類をここに覚えます。',
      ),
    ).toBeInTheDocument()
  })

  it('取得に失敗したら再読み込みの手段を出し、押すと取り直す', async () => {
    const user = userEvent.setup()
    mockFetch(
      respondWith({ '/api/classification/merchant-rules': new Error('network unreachable') }),
    )
    renderTab()

    expect(await screen.findByText('学習ルールの取得に失敗しました')).toBeInTheDocument()

    mockFetch(respondWith())
    await user.click(screen.getByRole('button', { name: '再読み込み' }))

    expect(await screen.findByText('ライフ 中目黒店')).toBeInTheDocument()
    expect(screen.queryByText('学習ルールの取得に失敗しました')).not.toBeInTheDocument()
  })

  it('片方の一覧の取得失敗が、もう片方の一覧の表示を巻き込まない', async () => {
    mockFetch(respondWith({ '/api/classification/amazon-rules': new Error('boom') }))
    renderTab()

    expect(
      await screen.findByText('Amazon 商品の学習ルールの取得に失敗しました'),
    ).toBeInTheDocument()
    expect(screen.getByText('ライフ 中目黒店')).toBeInTheDocument()
  })

  it('マスタ名を取得できるまでは行を出さない（ID や「（不明）」を見せてから差し替えない）', async () => {
    mockFetch(respondWith({ '/api/categories': new Promise<never>(() => {}) }))
    renderTab()

    await waitFor(() => {
      expect(screen.getAllByText('読み込み中...').length).toBeGreaterThan(0)
    })
    expect(screen.queryByText('ライフ 中目黒店')).not.toBeInTheDocument()
    expect(screen.queryByText('（不明）')).not.toBeInTheDocument()
  })

  it('「学習を止める」は確認で影響を説明し、確定するまで無効化を実行しない', async () => {
    const user = userEvent.setup()
    mockFetch(respondWith())
    renderTab()

    await user.click(await screen.findByRole('button', { name: 'ライフ 中目黒店の学習を止める' }))

    const dialog = screen.getByRole('dialog')
    expect(
      within(dialog).getByText(/覚えた内容を消し、以後は手動で分類しても覚え直しません/),
    ).toBeInTheDocument()
    expect(apiMock.apiMutate).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: '学習を止める' }))

    await waitFor(() => {
      expect(apiMock.apiMutate).toHaveBeenCalledWith(
        '/api/classification/merchant-rules/disable',
        { method: 'POST', body: { merchantName: 'ライフ 中目黒店' } },
        expect.anything(),
      )
    })
  })

  it('停止中のルールは再有効化 API を呼ぶ', async () => {
    const user = userEvent.setup()
    mockFetch(respondWith())
    renderTab()

    await user.click(await screen.findByRole('button', { name: 'セブンイレブンの学習を再開する' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '学習を再開する' }),
    )

    await waitFor(() => {
      expect(apiMock.apiMutate).toHaveBeenCalledWith(
        '/api/classification/merchant-rules/reenable',
        { method: 'POST', body: { merchantName: 'セブンイレブン' } },
        expect.anything(),
      )
    })
  })

  it('無効化に失敗したらモーダル内に理由と次の行動を出し、モーダルを閉じない', async () => {
    const user = userEvent.setup()
    mockFetch(respondWith())
    apiMock.apiMutate.mockRejectedValue(new Error('サーバーエラー'))
    renderTab()

    await user.click(await screen.findByRole('button', { name: 'ライフ 中目黒店の学習を止める' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '学習を止める' }),
    )

    expect(await screen.findByText('サーバーエラー')).toBeInTheDocument()
    expect(screen.getByText('時間をおいて、もう一度お試しください。')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
