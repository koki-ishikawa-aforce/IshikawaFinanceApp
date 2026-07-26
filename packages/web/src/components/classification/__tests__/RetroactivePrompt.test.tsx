import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  apiMutate: vi.fn(),
}))
vi.mock('@/lib/api-client', () => apiMock)

const { RetroactivePrompt } = await import('../RetroactivePrompt')
const { RetroactiveCandidatesWireSchema } = await import('@/lib/api-schemas')

/** apiFetch はスキーマ検証済みの値を返すため、テストでも同じスキーマを通す（日付は Date） */
function candidatesResponse(count: number): unknown {
  return RetroactiveCandidatesWireSchema.parse({
    userId: 'U_DARLING',
    merchantName: 'スーパーA',
    candidates: Array.from({ length: count }, (_, i) => ({
      transactionId: `TX_PAST_${i + 1}`,
      occurredAt: `2026-0${i + 4}-10T09:00:00.000Z`,
      amount: 1000 * (i + 1),
    })),
    proposedAt: '2026-07-24T00:00:00.000Z',
  })
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

  it('チェックを外した取引は適用対象から除かれる', async () => {
    const user = userEvent.setup()
    renderWithClient(<RetroactivePrompt merchantName="スーパーA" onDone={vi.fn()} />)

    const checkboxes = await screen.findAllByRole('checkbox')
    await user.click(checkboxes[0] as HTMLElement)
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

  it('適用後は反映した件数を表示する', async () => {
    const user = userEvent.setup()
    renderWithClient(<RetroactivePrompt merchantName="スーパーA" onDone={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: '選んだ 2 件も同じ分類にする' }))

    expect(await screen.findByText('過去の 2 件も同じ分類にしました。')).toBeInTheDocument()
  })

  it('候補が 0 件なら確認を出さずに閉じる', async () => {
    const onDone = vi.fn()
    apiMock.apiFetch.mockResolvedValue(candidatesResponse(0))
    renderWithClient(<RetroactivePrompt merchantName="スーパーA" onDone={onDone} />)

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(screen.queryByText(/まとめて同じ分類にしますか/)).not.toBeInTheDocument()
  })

  it('候補の取得に失敗したら再試行手段を出し、分類は保存済みだと伝える', async () => {
    apiMock.apiFetch.mockRejectedValue(new Error('boom'))
    renderWithClient(<RetroactivePrompt merchantName="スーパーA" onDone={vi.fn()} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '過去の未分類取引を確認できませんでした。この取引の分類は保存済みです。',
    )
    expect(screen.getByRole('button', { name: 'もう一度確認する' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /同じ分類にする/ })).not.toBeInTheDocument()
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
