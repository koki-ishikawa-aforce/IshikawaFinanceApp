import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LearningRulesTab } from '../LearningRulesTab'

const apiMock = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  apiMutate: vi.fn(),
}))

vi.mock('@/lib/api-client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>()
  return { ...actual, ...apiMock }
})

/** サーバーの JSON 応答（Date は ISO 文字列）をそのまま模す。ワイヤースキーマの検証も通す */
const ACTIVE_RULE = {
  kind: 'active',
  common: { userId: 'U_ME', merchantName: 'ライフ 中目黒店' },
  categoryRef: { kind: 'learned', categoryId: 'CAT_FOOD' },
  expenseClassRef: { kind: 'learned', expenseClass: 'household' },
  expenseTypeRef: { kind: 'unlearned' },
  lastUpdatedAt: '2026-07-18T04:20:00.000Z',
}

const DISABLED_RULE = {
  kind: 'disabled',
  common: { userId: 'U_ME', merchantName: 'セブンイレブン' },
  disabledAt: '2026-06-30T12:00:00.000Z',
}

/** 経費(会社)を経費種別まで学習済みのルール。ID ではなくマスタ名で出ることの検証に使う */
const EXPENSE_RULE = {
  kind: 'active',
  common: { userId: 'U_ME', merchantName: 'ブックストア 恵比寿' },
  categoryRef: { kind: 'learned', categoryId: 'CAT_OTHER' },
  expenseClassRef: { kind: 'learned', expenseClass: 'business_expense' },
  expenseTypeRef: { kind: 'learned', expenseTypeId: 'ET_BOOKS' },
  lastUpdatedAt: '2026-07-12T09:00:00.000Z',
}

const MERCHANT_RULES = { items: [ACTIVE_RULE, EXPENSE_RULE, DISABLED_RULE] }

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
function respondWith(overrides: Record<string, unknown> = {}): Responder {
  const table: Record<string, unknown> = {
    '/api/classification/merchant-rules': MERCHANT_RULES,
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

/** 解決の時点をテストから制御する Promise（未解決のまま保つ・任意のタイミングで解決する） */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => {
    resolve = r
  })
  return { promise, resolve }
}

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const result = render(
    <QueryClientProvider client={queryClient}>
      <LearningRulesTab />
    </QueryClientProvider>,
  )
  return { ...result, queryClient }
}

/** 一覧の取得が終わったこと（＝残る未解決はマスタだけ）をテスト側で確定させる */
async function waitForRulesLoaded(queryClient: QueryClient): Promise<void> {
  await waitFor(() => {
    expect(queryClient.getQueryState(['classification', 'merchant-rules'])?.status).toBe('success')
  })
}

function rowOf(name: string): HTMLElement {
  const row = screen.getByText(name).closest('li')
  expect(row).not.toBeNull()
  return row as HTMLElement
}

// 実 api-client を土台にモックしているため、モックし忘れた呼び出しは本物の fetch へ抜ける。
// 抜けた瞬間に落として、「通信できませんでした」が出るだけの読み解けない失敗にしない
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('テストがモックしていない fetch を呼んだ')
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  apiMock.apiFetch.mockReset()
  apiMock.apiMutate.mockReset()
  apiMock.apiMutate.mockResolvedValue(undefined)
})

describe('LearningRulesTab', () => {
  it('加盟店ルールを、マスタ名に解決して一覧表示する', async () => {
    mockFetch(respondWith())
    renderTab()

    expect(await screen.findByText('ライフ 中目黒店')).toBeInTheDocument()
    // カテゴリ ID ではなくマスタ名で表示する
    expect(screen.getByText('食費')).toBeInTheDocument()
    expect(screen.queryByText('CAT_FOOD')).not.toBeInTheDocument()
    // 経費種別も ID ではなくマスタ名で表示する(カテゴリ名と取り違えていない)
    expect(within(rowOf('ブックストア 恵比寿')).getByText('書籍代')).toBeInTheDocument()
    expect(screen.queryByText('ET_BOOKS')).not.toBeInTheDocument()
    // 最終更新日は lastUpdatedAt 由来（disabledAt と取り違えていない）
    expect(within(rowOf('ライフ 中目黒店')).getByText('最終更新日: 2026/07/18')).toBeInTheDocument()
  })

  it('軸のラベルと値が対応して並ぶ（未学習の軸だけが「まだ覚えていません」になる）', async () => {
    mockFetch(respondWith())
    renderTab()

    await screen.findByText('ライフ 中目黒店')
    const row = within(rowOf('ライフ 中目黒店'))
    const axisValueOf = (axis: string) =>
      row.getByText(axis).parentElement?.querySelector('dd')?.textContent

    expect(axisValueOf('カテゴリ')).toBe('食費')
    expect(axisValueOf('費用区分')).toBe('世帯')
    expect(axisValueOf('経費種別')).toBe('まだ覚えていません')
  })

  it('学習中と停止中を区別し、停止中の行には再開の操作だけを出す', async () => {
    mockFetch(respondWith())
    renderTab()

    await screen.findByText('セブンイレブン')
    const stopped = within(rowOf('セブンイレブン'))
    expect(stopped.getByText('学習を停止中')).toBeInTheDocument()
    expect(stopped.getByText('停止した日: 2026/06/30')).toBeInTheDocument()
    expect(
      stopped.getByRole('button', { name: 'セブンイレブンの学習を再開する' }),
    ).toBeInTheDocument()
    expect(
      stopped.queryByRole('button', { name: 'セブンイレブンの学習を止める' }),
    ).not.toBeInTheDocument()
  })

  it('Amazon 商品の学習は一覧も取得も行わない（X-1 取り下げ、#572）', async () => {
    mockFetch(respondWith())
    renderTab()

    await screen.findByText('ライフ 中目黒店')
    expect(screen.queryByText('Amazon 商品の学習')).not.toBeInTheDocument()
    expect(apiMock.apiFetch).not.toHaveBeenCalledWith(
      '/api/classification/amazon-rules',
      expect.anything(),
    )
  })

  it('学習ルールが 1 件も無いとき、一覧が何をすれば埋まるかを示す', async () => {
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

    // 読み上げに載るのは失敗の文言だけで、再読み込みボタンは読み上げ範囲の外に置く
    const alert = screen.getByRole('alert', { name: undefined })
    expect(alert).toHaveTextContent('学習ルールの取得に失敗しました')
    expect(within(alert).queryByRole('button')).toBeNull()

    mockFetch(respondWith())
    await user.click(screen.getByRole('button', { name: '再読み込み' }))

    expect(await screen.findByText('ライフ 中目黒店')).toBeInTheDocument()
    expect(screen.queryByText('学習ルールの取得に失敗しました')).not.toBeInTheDocument()
  })

  it('マスタの取得に失敗したら、名前を「（不明）」に落とさず一覧をエラーにする', async () => {
    mockFetch(respondWith({ '/api/categories': new Error('boom') }))
    renderTab()

    expect(await screen.findByText('学習ルールの取得に失敗しました')).toBeInTheDocument()
    expect(screen.queryByText('（不明）')).not.toBeInTheDocument()
    expect(screen.queryByText('ライフ 中目黒店')).not.toBeInTheDocument()
  })

  it('一覧が揃ってもマスタ名を取得できるまでは行を出さず、揃った時点で名前付きで出す', async () => {
    const categories = deferred<unknown>()
    mockFetch(respondWith({ '/api/categories': categories.promise }))
    const { queryClient } = renderTab()

    // ルール取得は完了済み・マスタだけ未解決、という主張どおりの状態を確定させる
    await waitForRulesLoaded(queryClient)
    expect(screen.queryByText('ライフ 中目黒店')).not.toBeInTheDocument()
    expect(screen.queryByText('（不明）')).not.toBeInTheDocument()
    expect(screen.getAllByText('読み込み中...').length).toBe(1)

    categories.resolve(CATEGORIES)

    expect(await screen.findByText('ライフ 中目黒店')).toBeInTheDocument()
    expect(screen.getByText('食費')).toBeInTheDocument()
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
  })

  it('確認を閉じたら無効化を実行しない', async () => {
    const user = userEvent.setup()
    mockFetch(respondWith())
    renderTab()

    await user.click(await screen.findByRole('button', { name: 'ライフ 中目黒店の学習を止める' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '閉じる' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(apiMock.apiMutate).not.toHaveBeenCalled()
  })

  it('学習を止めると確認が閉じ、行が停止中になって結果が伝わる', async () => {
    const user = userEvent.setup()
    mockFetch(respondWith())
    renderTab()

    await user.click(await screen.findByRole('button', { name: 'ライフ 中目黒店の学習を止める' }))

    // 確定後の再取得では当該加盟店が停止中になっている
    mockFetch(
      respondWith({
        '/api/classification/merchant-rules': {
          items: [
            {
              kind: 'disabled',
              common: { userId: 'U_ME', merchantName: 'ライフ 中目黒店' },
              disabledAt: '2026-07-20T02:00:00.000Z',
            },
            DISABLED_RULE,
          ],
        },
      }),
    )
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '学習を止める' }),
    )

    await waitFor(() => {
      expect(apiMock.apiMutate).toHaveBeenCalledWith(
        '/api/classification/merchant-rules/disable',
        { method: 'POST', body: { merchantName: 'ライフ 中目黒店' } },
        expect.anything(),
      )
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('「ライフ 中目黒店」の学習を止めました')).toBeInTheDocument()
    expect(within(rowOf('ライフ 中目黒店')).getByText('学習を停止中')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'ライフ 中目黒店の学習を止める' }),
    ).not.toBeInTheDocument()
  })

  it('停止中のルールを再開すると学習中に戻り、覚えている内容は空から始まる', async () => {
    const user = userEvent.setup()
    mockFetch(respondWith())
    renderTab()

    await user.click(await screen.findByRole('button', { name: 'セブンイレブンの学習を再開する' }))

    mockFetch(
      respondWith({
        '/api/classification/merchant-rules': {
          items: [
            {
              kind: 'active',
              common: { userId: 'U_ME', merchantName: 'セブンイレブン' },
              categoryRef: { kind: 'unlearned' },
              expenseClassRef: { kind: 'unlearned' },
              expenseTypeRef: { kind: 'unlearned' },
              lastUpdatedAt: '2026-07-20T02:00:00.000Z',
            },
          ],
        },
      }),
    )
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
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const row = within(rowOf('セブンイレブン'))
    expect(row.getByText('学習中')).toBeInTheDocument()
    expect(row.getAllByText('まだ覚えていません')).toHaveLength(3)
  })

  it('実行中は確定ボタンを押せなくし、二重に実行しない', async () => {
    const user = userEvent.setup()
    mockFetch(respondWith())
    const pending = deferred<unknown>()
    apiMock.apiMutate.mockReturnValue(pending.promise)
    renderTab()

    await user.click(await screen.findByRole('button', { name: 'ライフ 中目黒店の学習を止める' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: '学習を止める' }))

    const confirm = await within(dialog).findByRole('button', { name: '停止中...' })
    expect(confirm).toBeDisabled()
    await user.click(confirm)
    expect(apiMock.apiMutate).toHaveBeenCalledTimes(1)

    pending.resolve(undefined)
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
    expect(screen.queryByText('「ライフ 中目黒店」の学習を止めました')).not.toBeInTheDocument()
  })
})
