/**
 * 残高の手入力モーダルのテスト（#406）。
 *
 * 押さえているのは「どこへ・どの項目名で送るか」と「送れない入力を送らせないか」。
 * 取り崩し（`POST /withdraw` + `amount`）と補正（`PUT /balance` + `balance`）は
 * 送り先も項目名も違い、取り違えると「30,000 円取り崩したつもりが残高 30,000 円に補正された」
 * が型も通るまま成立する。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ManualEntryModal, type ManualEntryKind } from '../ManualEntryModal'
import { ApiError, NetworkError } from '@/lib/api-client'

const apiMutate = vi.fn()

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client')
  return {
    ...actual,
    apiMutate: (path: string, options: unknown, schema: unknown) =>
      apiMutate(path, options, schema),
  }
})

function renderModal(kind: ManualEntryKind, onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  render(
    <QueryClientProvider client={queryClient}>
      <ManualEntryModal
        accountId="ACC_TEST_001"
        kind={kind}
        currentBalance={1740000}
        onClose={onClose}
      />
    </QueryClientProvider>,
  )
  return { onClose, invalidate }
}

function amountField(kind: ManualEntryKind): HTMLElement {
  return screen.getByLabelText(kind === 'withdrawal' ? '取り崩した金額（円）' : '実際の残高（円）')
}

beforeEach(() => {
  apiMutate.mockReset()
  apiMutate.mockResolvedValue({})
})

describe('送り先と送る項目', () => {
  it('取り崩しは withdraw に amount で送る', async () => {
    renderModal('withdrawal')

    await userEvent.type(amountField('withdrawal'), '30000')
    await userEvent.type(screen.getByLabelText('メモ（任意）'), '旅行費')
    await userEvent.click(screen.getByRole('button', { name: '記録する' }))

    await waitFor(() => expect(apiMutate).toHaveBeenCalled())
    expect(apiMutate.mock.calls[0]?.[0]).toBe('/api/accounts/ACC_TEST_001/withdraw')
    expect(apiMutate.mock.calls[0]?.[1]).toEqual({
      method: 'POST',
      body: { amount: 30000, memo: '旅行費' },
    })
  })

  it('補正は balance に balance で送る', async () => {
    renderModal('correction')

    await userEvent.type(amountField('correction'), '1800000')
    await userEvent.click(screen.getByRole('button', { name: '補正する' }))

    await waitFor(() => expect(apiMutate).toHaveBeenCalled())
    expect(apiMutate.mock.calls[0]?.[0]).toBe('/api/accounts/ACC_TEST_001/balance')
    expect(apiMutate.mock.calls[0]?.[1]).toEqual({
      method: 'PUT',
      body: { balance: 1800000 },
    })
  })

  it('メモが空白だけなら項目ごと送らない（「書いていない」と区別が付かないため）', async () => {
    renderModal('withdrawal')

    await userEvent.type(amountField('withdrawal'), '1000')
    await userEvent.type(screen.getByLabelText('メモ（任意）'), '   ')
    await userEvent.click(screen.getByRole('button', { name: '記録する' }))

    await waitFor(() => expect(apiMutate).toHaveBeenCalled())
    expect(apiMutate.mock.calls[0]?.[1]).toEqual({ method: 'POST', body: { amount: 1000 } })
  })

  it('成功したら残高まわりの表示を取り直し、モーダルを閉じる', async () => {
    const { onClose, invalidate } = renderModal('withdrawal')

    await userEvent.type(amountField('withdrawal'), '1000')
    await userEvent.click(screen.getByRole('button', { name: '記録する' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['balances'] })
  })
})

describe('送れない入力', () => {
  it.each([
    ['未入力', ''],
    ['小数', '1000.5'],
    ['カンマ入り', '30,000'],
    ['0 円の取り崩し', '0'],
    ['マイナス', '-1000'],
  ])('%s は送信できず、受け付ける形を画面で伝える', async (_name, input) => {
    renderModal('withdrawal')

    if (input !== '') await userEvent.type(amountField('withdrawal'), input)

    expect(screen.getByRole('button', { name: '記録する' })).toBeDisabled()
    // 押せない理由を disabled だけで伝えない（usability.md 3-5）。未入力のうちは出さない
    if (input === '') {
      expect(screen.queryByText(/使えません/)).not.toBeInTheDocument()
    } else {
      expect(screen.getByText(/カンマ・小数は使えません/)).toBeInTheDocument()
    }
    expect(apiMutate).not.toHaveBeenCalled()
  })

  it('補正は 0 円を受け付ける（使い切った口座を 0 円と入れ直せる）', async () => {
    renderModal('correction')

    await userEvent.type(amountField('correction'), '0')

    expect(screen.getByRole('button', { name: '補正する' })).toBeEnabled()
  })
})

describe('失敗したときの伝え方', () => {
  it('409 は口座の状態の問題として伝える（入力の直し方と違うため）', async () => {
    apiMutate.mockRejectedValue(new ApiError(409, '{"error":"conflict"}'))
    renderModal('withdrawal')

    await userEvent.type(amountField('withdrawal'), '99999999')
    await userEvent.click(screen.getByRole('button', { name: '記録する' }))

    expect(await screen.findByText(/残高を超える取り崩しか/)).toBeInTheDocument()
  })

  it('通信できないときは通信の失敗として伝える', async () => {
    apiMutate.mockRejectedValue(new NetworkError('unreachable'))
    renderModal('correction')

    await userEvent.type(amountField('correction'), '1000')
    await userEvent.click(screen.getByRole('button', { name: '補正する' }))

    expect(await screen.findByText(/通信/)).toBeInTheDocument()
  })
})
