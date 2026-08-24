/**
 * 口座詳細画面のテスト（#406）。押さえているのは 5 つ。
 *
 * - 他人の口座（API が 404）で金額・履歴が一切出ず、権限による制限だと分かる文言が出ること
 *   （プライバシー3段階ルールの否定形。口座ごとの残高は本人のみ可視）
 * - 残高とグラフの食い違いに気づける知らせが出ること / 食い違いが無ければ出ないこと（#566 の決定）
 * - 手入力ボタンは API が「手入力できる口座」と答えたときだけ出ること
 * - 履歴が自動反映と手入力を混ぜて出し、増減に符号が付くこと
 * - 期間の切り替えが、実際に問い合わせる期間を変えること
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import AccountDetailPage from '../page'
import { ApiError, NetworkError } from '@/lib/api-client'
import { AccountDetailWireSchema } from '@/lib/api-schemas'

const apiFetch = vi.fn()
const searchParams = vi.fn(() => new URLSearchParams('id=ACC_TEST_001'))

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client')
  return {
    ...actual,
    apiFetch: (path: string, schema: { parse: (input: unknown) => unknown }) =>
      apiFetch(path, schema),
  }
})

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams(),
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

function detailResponse(overrides: Record<string, unknown> = {}): unknown {
  return {
    accountId: 'ACC_TEST_001',
    kind: 'other_savings',
    displayName: '楽天銀行',
    isActive: true,
    currentValue: 1740000,
    lastUpdatedAt: '2026-06-14T00:00:00.000Z',
    supportsBalanceManualEntry: true,
    yearMonthRange: { from: '2026-02', to: '2026-07' },
    series: [
      { date: '2026-04-18T00:00:00.000Z', amount: 1700000 },
      { date: '2026-06-14T00:00:00.000Z', amount: 1740000 },
    ],
    history: [
      {
        occurredAt: '2026-06-14T00:00:00.000Z',
        valueAfter: 1740000,
        delta: 40000,
        source: 'manual_correction',
        memo: '通帳を見て入れ直した',
      },
      {
        occurredAt: '2026-04-18T00:00:00.000Z',
        valueAfter: 1700000,
        delta: -30000,
        source: 'auto',
      },
    ],
    ...overrides,
  }
}

/**
 * 口座詳細だけを返し、鮮度は空で返す（この画面の検証に鮮度は要らない）。
 * 応答は実際の画面と同じく wire スキーマを通す（日付が文字列のままにならないようにする）。
 */
function mockApi(detail: unknown | Error) {
  apiFetch.mockImplementation((path: string) => {
    if (path.startsWith('/api/balances/accounts/')) {
      return detail instanceof Error
        ? Promise.reject(detail)
        : Promise.resolve(AccountDetailWireSchema.parse(detail))
    }
    return Promise.resolve({ items: [] })
  })
}

/** 口座詳細を取りに行ったパス（期間の検証に使う） */
function detailRequestPaths(): string[] {
  return apiFetch.mock.calls
    .map(call => String(call[0]))
    .filter(path => path.startsWith('/api/balances/accounts/'))
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AccountDetailPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  apiFetch.mockReset()
  searchParams.mockReturnValue(new URLSearchParams('id=ACC_TEST_001'))
})

describe('口座詳細の可視範囲（本人のみ）', () => {
  it('他人の口座（404）では金額も履歴も出さず、本人だけが見られることを伝える', async () => {
    mockApi(new ApiError(404, '{"error":"Account not found"}'))
    renderPage()

    expect(await screen.findByText(/本人だけが見られます/)).toBeInTheDocument()
    // 相手の残高・銀行名・履歴のいずれも画面に出ない
    expect(screen.queryByText('楽天銀行')).not.toBeInTheDocument()
    expect(screen.queryByText(/1,740,000/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取り崩しを記録' })).not.toBeInTheDocument()
    // やり直しても結果が変わらないので、再読み込みの手段は出さない
    expect(screen.queryByRole('button', { name: '再読み込み' })).not.toBeInTheDocument()
  })

  it('通信できないときは通信の失敗として伝え、再読み込みの手段を出す', async () => {
    mockApi(new NetworkError('unreachable'))
    renderPage()

    expect(await screen.findByRole('button', { name: '再読み込み' })).toBeInTheDocument()
    expect(screen.queryByText(/本人だけが見られます/)).not.toBeInTheDocument()
  })
})

describe('残高とグラフの食い違いの知らせ（#566）', () => {
  it('グラフの最新の値が残高と違うときは、両方の金額を添えて知らせる', async () => {
    // 補正は残高に効いたがグラフ側の記録に反映されなかった状態
    mockApi(detailResponse({ currentValue: 1800000 }))
    renderPage()

    const notice = await screen.findByText(/推移グラフには/)
    expect(notice).toHaveTextContent('1,800,000円')
    expect(notice).toHaveTextContent('1,740,000円')
  })

  it('グラフの最新の値と残高が一致していれば知らせは出さない', async () => {
    mockApi(detailResponse())
    renderPage()

    expect(await screen.findByRole('heading', { name: '楽天銀行' })).toBeInTheDocument()
    expect(screen.queryByText(/推移グラフには/)).not.toBeInTheDocument()
  })

  it('記録が 1 件も無い口座では、比べる相手が無いので知らせを出さない', async () => {
    mockApi(detailResponse({ series: [], history: [] }))
    renderPage()

    expect(await screen.findByText(/この期間に記録された変動はありません/)).toBeInTheDocument()
    expect(screen.queryByText(/推移グラフには/)).not.toBeInTheDocument()
  })
})

describe('手入力の入口', () => {
  it('手入力できる口座では「取り崩しを記録」「残高を補正」を出す', async () => {
    mockApi(detailResponse())
    renderPage()

    expect(await screen.findByRole('button', { name: '取り崩しを記録' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '残高を補正' })).toBeInTheDocument()
  })

  it('手入力を受け付けない口座では出さない（種別ではなく API の答えで決める）', async () => {
    mockApi(
      detailResponse({
        kind: 'smbc_bank',
        displayName: '三井住友銀行',
        supportsBalanceManualEntry: false,
      }),
    )
    renderPage()

    expect(await screen.findByRole('heading', { name: '三井住友銀行' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取り崩しを記録' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '残高を補正' })).not.toBeInTheDocument()
  })

  it('使っていない口座では手入力の入口を出さない', async () => {
    mockApi(detailResponse({ isActive: false }))
    renderPage()

    expect(await screen.findByText('使っていない口座')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取り崩しを記録' })).not.toBeInTheDocument()
  })
})

describe('口座種別ごとの呼び名', () => {
  it('カード口座は「当月未払い」「前回精算」で、金額は残高一覧と同じマイナス表記になる', async () => {
    mockApi(
      detailResponse({
        kind: 'mitsui_sumitomo_card',
        displayName: '三井住友カード',
        currentValue: 120000,
        lastUpdatedAt: '2026-07-10T00:00:00.000Z',
        supportsBalanceManualEntry: false,
        series: [{ date: '2026-07-10T00:00:00.000Z', amount: 120000 }],
        history: [],
      }),
    )
    renderPage()

    // 残高カードの呼び名・グラフの見出し・凡例の 3 か所に出る
    expect(await screen.findAllByText('当月未払い')).not.toHaveLength(0)
    expect(screen.getByRole('heading', { name: '当月未払いの推移' })).toBeInTheDocument()
    expect(screen.getByText('-120,000円')).toBeInTheDocument()
    expect(screen.getByText('前回精算: 2026/07/10')).toBeInTheDocument()
  })

  it('一度も精算していないカード口座は「まだありません」と出す（登録日で代用しない）', async () => {
    mockApi(
      detailResponse({
        kind: 'mitsui_sumitomo_card',
        displayName: '三井住友カード',
        currentValue: 0,
        lastUpdatedAt: null,
        supportsBalanceManualEntry: false,
        series: [],
        history: [],
      }),
    )
    renderPage()

    expect(await screen.findByText('前回精算: まだありません')).toBeInTheDocument()
  })
})

describe('残高の変動履歴', () => {
  it('自動反映と手入力を混ぜて並べ、増減に符号を付ける', async () => {
    mockApi(detailResponse())
    renderPage()

    expect(await screen.findByText('残高補正')).toBeInTheDocument()
    expect(screen.getByText('自動反映')).toBeInTheDocument()
    expect(screen.getByText('+40,000円')).toBeInTheDocument()
    expect(screen.getByText('-30,000円')).toBeInTheDocument()
    expect(screen.getByText('通帳を見て入れ直した')).toBeInTheDocument()
  })

  it('起点が分からない行は増減を出さない（前の値が無いと差を出せない）', async () => {
    mockApi(
      detailResponse({
        history: [
          {
            occurredAt: '2026-04-18T00:00:00.000Z',
            valueAfter: 1700000,
            delta: null,
            source: 'auto',
          },
        ],
      }),
    )
    renderPage()

    expect(await screen.findByText('—')).toBeInTheDocument()
  })
})

describe('期間の切り替え', () => {
  it('既定は 6 ヶ月ぶんを要求し、「1年」を押すと 12 ヶ月ぶんに広がる', async () => {
    vi.setSystemTime(new Date('2026-07-15T00:00:00.000Z'))
    mockApi(detailResponse())
    renderPage()

    expect(await screen.findByRole('heading', { name: '楽天銀行' })).toBeInTheDocument()
    expect(detailRequestPaths()[0]).toContain('from=2026-02&to=2026-07')

    await userEvent.click(screen.getByRole('radio', { name: '1年' }))

    await waitFor(() => {
      expect(detailRequestPaths().at(-1)).toContain('from=2025-08&to=2026-07')
    })
    vi.useRealTimers()
  })
})

describe('口座が指定されていないとき', () => {
  it('問い合わせに行かず、口座を選ぶよう案内する', async () => {
    searchParams.mockReturnValue(new URLSearchParams(''))
    mockApi(detailResponse())
    renderPage()

    expect(await screen.findByText(/どの口座を見るかが指定されていません/)).toBeInTheDocument()
    expect(detailRequestPaths()).toEqual([])
  })
})
