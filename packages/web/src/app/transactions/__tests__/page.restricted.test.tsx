/**
 * 配偶者の個人取引を開いたとき、「データが無い」ではなく
 * 「権限で伏せている」と伝わる表示になっていることを固定する
 * (`docs/design/usability.md` 2-2 / #498)。
 *
 * 部品側(RestrictedState)の単体テストでは、画面がその部品を通しているかまでは
 * 担保できない。空状態に戻されても文言は同じままなので、文言だけを見るテストでは
 * 見た目が「データがありません」と同じに戻ったことに気づけない。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TransactionListWireSchema, UnclassifiedSummaryWireSchema } from '@/lib/api-schemas'

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

/** プライバシー適用で店舗名・金額が伏せられた行(配偶者の個人取引) */
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

const RESTRICTED_MESSAGE = '配偶者の個人取引のため、詳細の閲覧・編集はできません'

/**
 * パスで応答を振り分ける。応答は画面が読むスキーマに通してから返す。
 * 素通しにすると、画面が読む形と fixture がずれたことに気づけないまま緑になる
 */
function respond(): void {
  apiMock.apiFetch.mockImplementation((path: string) => {
    if (path.startsWith('/api/transactions/unclassified-summary')) {
      return Promise.resolve(UnclassifiedSummaryWireSchema.parse({ count: 0, recentIds: [] }))
    }
    if (path.startsWith('/api/transactions')) {
      return Promise.resolve(TransactionListWireSchema.parse([RESTRICTED_ROW, OWN_ROW]))
    }
    // マスタ(カテゴリ / 経費種別)は編集できる行のモーダルでしか使わない
    return Promise.resolve({ items: [] })
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

describe('配偶者の個人取引を開いたとき', () => {
  beforeEach(() => {
    apiMock.apiFetch.mockReset()
    apiMock.apiMutate.mockReset()
    respond()
  })

  it('伏せている理由を専用の表示で伝える(空状態の見た目に落とさない)', async () => {
    renderPage()
    const user = userEvent.setup()

    const row = await screen.findByText('（非公開）')
    await user.click(row)

    const message = await screen.findByText(RESTRICTED_MESSAGE)
    expect(message).toBeInTheDocument()

    // 空状態と同じ器に戻されていないこと。RestrictedState は錠前のアイコンを持ち、
    // EmptyState は「図形を持たないインラインのテキスト」であることを自らのテストで固定している
    const restricted = message.closest('div')
    expect(restricted?.querySelector('svg')).not.toBeNull()
  })

  it('編集の入力欄を出さない', async () => {
    renderPage()
    const user = userEvent.setup()

    await user.click(await screen.findByText('（非公開）'))
    await screen.findByText(RESTRICTED_MESSAGE)

    expect(screen.queryByText('店舗・摘要')).not.toBeInTheDocument()
    expect(screen.queryByText('基本情報を保存')).not.toBeInTheDocument()
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
