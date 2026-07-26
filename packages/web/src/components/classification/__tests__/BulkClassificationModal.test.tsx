import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BulkClassificationSessionWireSchema,
  type InProgressBulkClassificationSessionWire,
} from '@/lib/api-schemas'

const apiMock = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  apiMutate: vi.fn(),
}))
vi.mock('@/lib/api-client', () => apiMock)

const { BulkClassificationModal, groupTargetsByMerchant } =
  await import('../BulkClassificationModal')

function session(
  targets: { transactionId: string; merchantName: string }[],
): InProgressBulkClassificationSessionWire {
  const parsed = BulkClassificationSessionWireSchema.parse({
    kind: 'in_progress',
    common: {
      bulkClassificationSessionId: 'BCS_1',
      userId: 'U_DARLING',
      trigger: {
        kind: 'single_correction',
        transactionId: targets[0]?.transactionId,
        startedAt: '2026-07-24T00:00:00.000Z',
      },
      targets: targets.map(target => ({
        kind: 'unclassified',
        transactionId: target.transactionId,
        merchantName: target.merchantName,
        reason: 'merchant_rule_unlearned',
        defaultExpenseClass: 'personal_darling',
      })),
    },
    startedAt: '2026-07-24T00:00:00.000Z',
    remainingCount: targets.length,
  })
  if (parsed.kind !== 'in_progress') throw new Error('in_progress を期待')
  return parsed
}

function renderWithClient(element: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>)
}

beforeEach(() => {
  apiMock.apiFetch.mockImplementation((path: string) => {
    if (path === '/api/categories') {
      return Promise.resolve({
        items: [{ categoryId: 'CAT_FOOD', name: '食費', kind: 'default' }],
      })
    }
    if (path === '/api/expense-types') {
      return Promise.resolve({
        items: [{ expenseTypeId: 'ET_GYM', name: 'ジム', kind: 'default' }],
      })
    }
    throw new Error(`unexpected apiFetch: ${path}`)
  })
  apiMock.apiMutate.mockResolvedValue({})
})

afterEach(() => {
  vi.clearAllMocks()
})

/** カテゴリマスタの取得完了を待ってからカテゴリを選ぶ */
async function selectCategory(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('option', { name: '食費' })
  await user.selectOptions(screen.getByLabelText('カテゴリ'), 'CAT_FOOD')
}

/** カテゴリを選んで「この店舗の N 件を分類」を押す */
async function classifyCurrentGroup(user: ReturnType<typeof userEvent.setup>) {
  await selectCategory(user)
  await user.click(screen.getByRole('button', { name: /この店舗の \d+ 件を分類/ }))
}

describe('groupTargetsByMerchant', () => {
  it('同一加盟店の取引を 1 グループにまとめ、初出の順序を保つ', () => {
    const targets = session([
      { transactionId: 'TX1', merchantName: 'スーパーA' },
      { transactionId: 'TX2', merchantName: 'カフェB' },
      { transactionId: 'TX3', merchantName: 'スーパーA' },
    ]).common.targets

    expect(groupTargetsByMerchant(targets)).toEqual([
      { merchantName: 'スーパーA', targets: [targets[0], targets[2]] },
      { merchantName: 'カフェB', targets: [targets[1]] },
    ])
  })
})

describe('BulkClassificationModal', () => {
  it('加盟店ごとにまとめて表示し、同一加盟店の件数を示す', async () => {
    renderWithClient(
      <BulkClassificationModal
        session={session([
          { transactionId: 'TX1', merchantName: 'スーパーA' },
          { transactionId: 'TX2', merchantName: 'スーパーA' },
          { transactionId: 'TX3', merchantName: 'カフェB' },
        ])}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('スーパーA')).toBeInTheDocument()
    expect(screen.getByText('2 件')).toBeInTheDocument()
    // 3 取引でも加盟店は 2 件。進捗は加盟店単位で数える
    expect(screen.getByText('1 / 2 店舗（分類済み 0 件）')).toBeInTheDocument()
    expect(screen.queryByText('カフェB')).not.toBeInTheDocument()
  })

  it('カテゴリ未選択では分類できず、押せない理由を画面に出す', () => {
    renderWithClient(
      <BulkClassificationModal
        session={session([{ transactionId: 'TX1', merchantName: 'スーパーA' }])}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'この店舗の 1 件を分類' })).toBeDisabled()
    expect(screen.getByText('カテゴリを選ぶと分類できます')).toBeInTheDocument()
  })

  it('経費(会社) は経費種別を選ぶまで分類できない', async () => {
    const user = userEvent.setup()
    renderWithClient(
      <BulkClassificationModal
        session={session([{ transactionId: 'TX1', merchantName: 'スーパーA' }])}
        onClose={vi.fn()}
      />,
    )

    await selectCategory(user)
    await user.selectOptions(screen.getByLabelText('費用区分'), 'business_expense')

    expect(screen.getByRole('button', { name: 'この店舗の 1 件を分類' })).toBeDisabled()
    expect(screen.getByText('経費種別を選ぶと分類できます')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('経費種別'), 'ET_GYM')

    expect(screen.getByRole('button', { name: 'この店舗の 1 件を分類' })).toBeEnabled()
  })

  it('同一加盟店の取引をすべて分類してから次の加盟店へ進む', async () => {
    const user = userEvent.setup()
    renderWithClient(
      <BulkClassificationModal
        session={session([
          { transactionId: 'TX1', merchantName: 'スーパーA' },
          { transactionId: 'TX2', merchantName: 'スーパーA' },
          { transactionId: 'TX3', merchantName: 'カフェB' },
        ])}
        onClose={vi.fn()}
      />,
    )

    await classifyCurrentGroup(user)

    expect(await screen.findByText('カフェB')).toBeInTheDocument()
    expect(apiMock.apiMutate).toHaveBeenCalledWith(
      '/api/transactions/TX1/classify',
      { method: 'PUT', body: { categoryId: 'CAT_FOOD', expenseClass: 'personal_darling' } },
      expect.anything(),
    )
    expect(apiMock.apiMutate).toHaveBeenCalledWith(
      '/api/transactions/TX2/classify',
      expect.objectContaining({ method: 'PUT' }),
      expect.anything(),
    )
    // 次の加盟店の分類はまだ走っていない
    expect(apiMock.apiMutate).not.toHaveBeenCalledWith(
      '/api/transactions/TX3/classify',
      expect.anything(),
      expect.anything(),
    )
    expect(screen.getByText('2 / 2 店舗（分類済み 2 件）')).toBeInTheDocument()
  })

  it('最後の加盟店を分類するとセッションを完了し、処理件数を表示する', async () => {
    const user = userEvent.setup()
    apiMock.apiMutate.mockImplementation((path: string) => {
      if (path.endsWith('/complete')) {
        return Promise.resolve(
          BulkClassificationSessionWireSchema.parse({
            kind: 'completed',
            common: session([{ transactionId: 'TX1', merchantName: 'スーパーA' }]).common,
            startedAt: '2026-07-24T00:00:00.000Z',
            completedAt: '2026-07-24T00:10:00.000Z',
            processedCount: 1,
          }),
        )
      }
      return Promise.resolve({})
    })
    renderWithClient(
      <BulkClassificationModal
        session={session([{ transactionId: 'TX1', merchantName: 'スーパーA' }])}
        onClose={vi.fn()}
      />,
    )

    await classifyCurrentGroup(user)

    expect(
      await screen.findByText('1 件を分類しました。同じ店舗の取引は次回から自動で分類されます。', {
        exact: false,
      }),
    ).toBeInTheDocument()
    expect(apiMock.apiMutate).toHaveBeenCalledWith(
      '/api/classification/bulk-sessions/BCS_1/complete',
      { method: 'POST' },
      expect.anything(),
    )
  })

  it('とばした加盟店は分類されない', async () => {
    const user = userEvent.setup()
    renderWithClient(
      <BulkClassificationModal
        session={session([
          { transactionId: 'TX1', merchantName: 'スーパーA' },
          { transactionId: 'TX2', merchantName: 'カフェB' },
        ])}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'この店舗はとばす' }))

    expect(await screen.findByText('カフェB')).toBeInTheDocument()
    expect(apiMock.apiMutate).not.toHaveBeenCalledWith(
      '/api/transactions/TX1/classify',
      expect.anything(),
      expect.anything(),
    )
  })

  it('分類に失敗したら次の加盟店へ進まず、やり直しを促す', async () => {
    const user = userEvent.setup()
    apiMock.apiMutate.mockRejectedValue(new Error('boom'))
    renderWithClient(
      <BulkClassificationModal
        session={session([
          { transactionId: 'TX1', merchantName: 'スーパーA' },
          { transactionId: 'TX2', merchantName: 'カフェB' },
        ])}
        onClose={vi.fn()}
      />,
    )

    await classifyCurrentGroup(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '分類の保存に失敗しました。通信状態を確かめて、もう一度「この店舗を分類」を押してください。',
    )
    expect(screen.getByText('スーパーA')).toBeInTheDocument()
    expect(screen.queryByText('カフェB')).not.toBeInTheDocument()
  })

  it('「まとめて分類をやめる」でセッションを中断する', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderWithClient(
      <BulkClassificationModal
        session={session([{ transactionId: 'TX1', merchantName: 'スーパーA' }])}
        onClose={onClose}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'まとめて分類をやめる' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledWith('aborted'))
    expect(apiMock.apiMutate).toHaveBeenCalledWith(
      '/api/classification/bulk-sessions/BCS_1/abort',
      { method: 'POST' },
      expect.anything(),
    )
  })

  it('「あとで続ける」はセッションを中断せずに閉じる（再開できる）', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderWithClient(
      <BulkClassificationModal
        session={session([{ transactionId: 'TX1', merchantName: 'スーパーA' }])}
        onClose={onClose}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'あとで続ける' }))

    expect(onClose).toHaveBeenCalledWith('left')
    expect(apiMock.apiMutate).not.toHaveBeenCalled()
  })
})
