import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  apiMutate: vi.fn(),
}))
// ApiError は実物を使う（失敗の種類で文言を出し分けるため）
vi.mock('@/lib/api-client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>()
  return { ...apiMock, ApiError: actual.ApiError }
})

const { RetroactivePrompt } = await import('../RetroactivePrompt')
const { RetroactiveCandidatesWireSchema } = await import('@/lib/api-schemas')

/** apiFetch はスキーマ検証済みの値を返すため、テストでも同じスキーマを通す（日付は Date） */
const CANDIDATES = [
  { transactionId: 'TX_PAST_1', occurredAt: '2026-06-18T09:00:00.000Z', amount: 1420 },
  { transactionId: 'TX_PAST_2', occurredAt: '2025-05-30T09:00:00.000Z', amount: 980 },
]

function candidatesResponse(count: number): unknown {
  return RetroactiveCandidatesWireSchema.parse({
    userId: 'U_DARLING',
    merchantName: 'スーパーA',
    candidates: CANDIDATES.slice(0, count),
    proposedAt: '2026-07-24T00:00:00.000Z',
  })
}

async function candidateRows(): Promise<HTMLElement[]> {
  const list = await screen.findByRole('list')
  return within(list).getAllByRole('listitem')
}

function renderWithClient(element: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>)
}

beforeEach(() => {
  apiMock.apiFetch.mockResolvedValue(candidatesResponse(2))
  apiMock.apiMutate.mockResolvedValue({ merchantName: 'スーパーA', appliedCount: 2 })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('RetroactivePrompt', () => {
  it('過去の未分類取引の件数と加盟店名を示して確認する', async () => {
    renderWithClient(<RetroactivePrompt merchantName="スーパーA" onDone={vi.fn()} />)

    expect(
      await screen.findByText(/過去にも未分類の「スーパーA」の取引が 2 件あります/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '選んだ 2 件も同じ分類にする' })).toBeEnabled()
    expect(apiMock.apiFetch).toHaveBeenCalledWith(
      '/api/classification/retroactive-candidates?merchantName=%E3%82%B9%E3%83%BC%E3%83%91%E3%83%BCA',
      expect.anything(),
    )
  })

  it('候補の行に発生日（年つき）と金額を並べる', async () => {
    renderWithClient(<RetroactivePrompt merchantName="スーパーA" onDone={vi.fn()} />)

    const [first, second] = await candidateRows()
    // 月をまたいで並ぶため年まで出す（2026/06/18 と 2025/05/30 を取り違えない）
    expect(within(first as HTMLElement).getByText('2026/06/18')).toBeInTheDocument()
    expect(within(first as HTMLElement).getByText('¥1,420')).toBeInTheDocument()
    expect(within(second as HTMLElement).getByText('2025/05/30')).toBeInTheDocument()
    expect(within(second as HTMLElement).getByText('¥980')).toBeInTheDocument()
  })

  it('チェックを外した取引は適用対象から除かれる', async () => {
    const user = userEvent.setup()
    renderWithClient(<RetroactivePrompt merchantName="スーパーA" onDone={vi.fn()} />)

    const [first] = await candidateRows()
    // 日付・金額のどこを押してもその行のチェックが切り替わる（ラベルが行全体）
    await user.click(within(first as HTMLElement).getByText('¥1,420'))
    await user.click(screen.getByRole('button', { name: '選んだ 1 件も同じ分類にする' }))

    await waitFor(() =>
      expect(apiMock.apiMutate).toHaveBeenCalledWith(
        '/api/classification/retroactive-candidates/apply',
        { method: 'POST', body: { merchantName: 'スーパーA', transactionIds: ['TX_PAST_2'] } },
        expect.anything(),
      ),
    )
  })

  it('1 件も選ばれていなければ適用できず、理由を画面に出す', async () => {
    const user = userEvent.setup()
    renderWithClient(<RetroactivePrompt merchantName="スーパーA" onDone={vi.fn()} />)

    for (const checkbox of await screen.findAllByRole('checkbox')) {
      await user.click(checkbox)
    }

    expect(screen.getByRole('button', { name: '選んだ 0 件も同じ分類にする' })).toBeDisabled()
    expect(
      screen.getByText('変更する取引にチェックを入れると、まとめて変更できます。'),
    ).toBeInTheDocument()
    expect(apiMock.apiMutate).not.toHaveBeenCalled()
  })

  it('反映した件数は選んだ件数ではなくサーバーが実際に適用した件数を出す', async () => {
    const user = userEvent.setup()
    // 2 件選んでも、既に分類済みなどで実際に適用されるのは 1 件というケース
    apiMock.apiMutate.mockResolvedValue({ merchantName: 'スーパーA', appliedCount: 1 })
    renderWithClient(<RetroactivePrompt merchantName="スーパーA" onDone={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: '選んだ 2 件も同じ分類にする' }))

    expect(await screen.findByText('過去の 1 件も同じ分類にしました。')).toBeInTheDocument()
  })

  it('候補が 0 件なら確認を出さずに閉じる', async () => {
    const onDone = vi.fn()
    apiMock.apiFetch.mockResolvedValue(candidatesResponse(0))
    renderWithClient(<RetroactivePrompt merchantName="スーパーA" onDone={onDone} />)

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(screen.queryByText(/まとめて同じ分類にしますか/)).not.toBeInTheDocument()
  })

  it('候補の取得に失敗したら再試行手段を出し、分類は保存済みだと伝える', async () => {
    const user = userEvent.setup()
    apiMock.apiFetch.mockRejectedValueOnce(new Error('boom'))
    renderWithClient(<RetroactivePrompt merchantName="スーパーA" onDone={vi.fn()} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '過去の未分類取引を確認できませんでした。この取引の分類は保存済みです。',
    )
    expect(screen.queryByRole('button', { name: /同じ分類にする/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'もう一度確認する' }))

    // 再取得が成功すれば確認に戻れる
    expect(
      await screen.findByText(/過去にも未分類の「スーパーA」の取引が 2 件あります/),
    ).toBeInTheDocument()
  })

  it('学習の対象外の店舗（404 / 409）は、通信エラーではなく理由と次の行動を出す', async () => {
    const user = userEvent.setup()
    const { ApiError } = await import('@/lib/api-client')
    apiMock.apiMutate.mockRejectedValue(
      new ApiError(404, JSON.stringify({ error: 'MerchantLearningRule not found' })),
    )
    renderWithClient(<RetroactivePrompt merchantName="AMAZON.CO.JP" onDone={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: '選んだ 2 件も同じ分類にする' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'この店舗は自動分類の学習の対象外のため、まとめて変更できません。過去の取引は 1 件ずつ分類してください。',
    )
  })

  it('適用に失敗したら結果を表示せず、やり直しを促す', async () => {
    const user = userEvent.setup()
    apiMock.apiMutate.mockRejectedValue(new Error('boom'))
    renderWithClient(<RetroactivePrompt merchantName="スーパーA" onDone={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: '選んだ 2 件も同じ分類にする' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'まとめての変更に失敗しました。通信状態を確かめて、もう一度お試しください。',
    )
    expect(screen.queryByText(/過去の 2 件も同じ分類にしました/)).not.toBeInTheDocument()
  })
})
