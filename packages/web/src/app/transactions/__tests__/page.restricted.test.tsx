/**
 * 明細を伏せている行を開いたとき、「データが無い」ではなく
 * 「権限で伏せている」と伝わる表示になっていることを固定する
 * (`docs/design/usability.md` 2-2 / #498)。
 *
 * 部品側(RestrictedState)の単体テストでは、画面がその部品を通しているかまでは
 * 担保できない。空状態に戻されても文言は同じままなので、文言だけを見るテストでは
 * 見た目が「データがありません」と同じに戻ったことに気づけない。
 *
 * 前提: **本番の一覧にこの行は載らない**。domain の `applyPrivacyFilter` が相手の
 * 個人取引を行ごと除外するため、`GET /api/transactions` から明細が null の行は返らない。
 * ここで固定しているのは、モック起動モードと保険の経路での見せ方。
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CategoryListWireSchema,
  ExpenseTypeListWireSchema,
  TransactionListWireSchema,
  UnclassifiedSummaryWireSchema,
} from '@/lib/api-schemas'

const apiMock = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  apiMutate: vi.fn(),
}))
vi.mock('@/lib/api-client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>()
  return { ...actual, ...apiMock }
})

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('month=2026-07'),
}))

const TransactionsPage = (await import('../page')).default

/** 明細が伏せられた個人費の行 */
const RESTRICTED_ROW = {
  transactionId: '01JEEEEEEEEEEEEEEEEEEEEEE1',
  occurredAt: '2026-07-05',
  expenseClass: 'personal_darling',
  categoryId: null,
  categoryName: null,
  merchantName: null,
  amount: null,
  isUnclassified: false,
}

/** 自分の取引。同じ一覧に並ぶが、こちらは編集できる */
const OWN_ROW = {
  transactionId: '01JEEEEEEEEEEEEEEEEEEEEEE2',
  occurredAt: '2026-07-06',
  expenseClass: 'household',
  categoryId: '01HQ8ZKJ9M3N4P5Q6R7S8T9VWX',
  categoryName: '食費',
  merchantName: 'スーパー',
  amount: 1200,
  isUnclassified: false,
}

/**
 * 経費(会社)で明細が伏せられた行。usability 2-3 により、相手の画面には
 * 「見えないものがある」ことすら示唆してはならない
 */
const RESTRICTED_BUSINESS_ROW = {
  ...RESTRICTED_ROW,
  transactionId: '01JEEEEEEEEEEEEEEEEEEEEEE3',
  occurredAt: '2026-07-04',
  expenseClass: 'business_expense',
}

const RESTRICTED_MESSAGE = 'パートナーの個人取引のため、詳細の閲覧・編集はできません'

/**
 * パスで応答を振り分ける。応答は画面が読むスキーマに通してから返す。
 * 素通しにすると、画面が読む形と fixture がずれたことに気づけないまま緑になる
 */
function respond(rows: unknown[]): void {
  apiMock.apiFetch.mockImplementation((path: string) => {
    if (path.startsWith('/api/transactions/unclassified-summary')) {
      return Promise.resolve(UnclassifiedSummaryWireSchema.parse({ count: 0, recentIds: [] }))
    }
    if (path.startsWith('/api/transactions')) {
      return Promise.resolve(TransactionListWireSchema.parse(rows))
    }
    if (path.startsWith('/api/categories')) {
      return Promise.resolve(CategoryListWireSchema.parse({ items: [] }))
    }
    return Promise.resolve(ExpenseTypeListWireSchema.parse({ items: [] }))
  })
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <TransactionsPage />
    </QueryClientProvider>,
  )
}

/** 伏せられた行を開いてダイアログを返す */
async function openRestrictedRow(): Promise<HTMLElement> {
  const user = userEvent.setup()
  await user.click((await screen.findAllByText('（非公開）'))[0] as HTMLElement)
  return await screen.findByRole('dialog')
}

describe('明細を伏せている個人費の行を開いたとき', () => {
  beforeEach(() => {
    apiMock.apiFetch.mockReset()
    apiMock.apiMutate.mockReset()
    respond([RESTRICTED_ROW, OWN_ROW])
  })

  it('伏せている理由を専用の表示で伝える(空状態の見た目に落とさない)', async () => {
    renderPage()

    const dialog = await openRestrictedRow()
    const message = await within(dialog).findByText(RESTRICTED_MESSAGE)

    // 空状態に戻されていないこと。RestrictedState は錠前のアイコンを持ち、
    // EmptyState は「図形を持たないインラインのテキスト」であることを自らのテストで固定している
    const face = message.parentElement
    expect(face).not.toBeNull()
    expect(face?.querySelector('svg')).not.toBeNull()
  })

  it('読み上げにも伏せている旨が伝わる(モーダルは開いても読み上げられないため)', async () => {
    renderPage()

    const dialog = await openRestrictedRow()

    expect(await within(dialog).findByRole('status')).toHaveTextContent(RESTRICTED_MESSAGE)
  })

  it('編集の入力欄を出さず、見出しでも「編集」と掲げない', async () => {
    renderPage()

    const dialog = await openRestrictedRow()
    await within(dialog).findByText(RESTRICTED_MESSAGE)

    expect(dialog).toHaveAccessibleName('取引の詳細')
    expect(within(dialog).queryByText('店舗・摘要')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('基本情報を保存')).not.toBeInTheDocument()
  })

  it('自分の取引ではこの表示を出さない', async () => {
    renderPage()
    const user = userEvent.setup()

    await user.click(await screen.findByText('スーパー'))

    await waitFor(() => {
      expect(screen.getByText('店舗・摘要')).toBeInTheDocument()
    })
    expect(screen.queryByText(RESTRICTED_MESSAGE)).not.toBeInTheDocument()
  })
})

describe('経費(会社)で明細が伏せられた行を開いたとき', () => {
  beforeEach(() => {
    apiMock.apiFetch.mockReset()
    apiMock.apiMutate.mockReset()
    respond([RESTRICTED_BUSINESS_ROW, OWN_ROW])
  })

  it('「見えないものがある」ことを示唆する表示を出さない(usability 2-3)', async () => {
    renderPage()

    const dialog = await openRestrictedRow()

    // 経費は合計すら不可視。個人費と同じ案内を出すと、存在そのものを漏らすことになる
    expect(within(dialog).queryByText(RESTRICTED_MESSAGE)).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('status')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('店舗・摘要')).not.toBeInTheDocument()
  })
})
