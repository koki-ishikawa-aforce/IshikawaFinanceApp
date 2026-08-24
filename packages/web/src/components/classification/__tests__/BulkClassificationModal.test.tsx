import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BulkClassificationSessionWireSchema,
  type BulkClassificationTargetWire,
  type InProgressBulkClassificationSessionWire,
} from '@/lib/api-schemas'

const apiMock = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  apiMutate: vi.fn(),
}))
vi.mock('@/lib/api-client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>()
  return { ...actual, ...apiMock }
})

const { BulkClassificationModal, groupTargetsByMerchant } =
  await import('../BulkClassificationModal')

function session(
  targets: { transactionId: string; merchantName: string; reason?: string }[],
): InProgressBulkClassificationSessionWire {
  const parsed = BulkClassificationSessionWireSchema.parse({
    kind: 'in_progress',
    common: {
      bulkClassificationSessionId: 'BCS_1',
      userId: 'U_DARLING',
      trigger: {
        kind: 'transaction_list',
        startedAt: '2026-07-24T00:00:00.000Z',
      },
      targets: targets.map(target => ({
        kind: 'unclassified',
        transactionId: target.transactionId,
        merchantName: target.merchantName,
        reason: target.reason ?? 'merchant_rule_unlearned',
        defaultExpenseClass: 'personal_darling',
      })),
    },
    startedAt: '2026-07-24T00:00:00.000Z',
    classifiedTransactionIds: [],
    remainingCount: targets.length,
  })
  if (parsed.kind !== 'in_progress') throw new Error('in_progress を期待')
  return parsed
}

/**
 * 既定では「セッションの対象をそのまま提示し、引き継ぐ進捗は無し」で描画する。
 * 再開の引き継ぎを見るテストだけが targets / classifiedTransactionIds を明示する。
 */
function ModalUnderTest(props: {
  session: InProgressBulkClassificationSessionWire
  targets?: BulkClassificationTargetWire[]
  classifiedTransactionIds?: string[]
  onClose: (reason: 'completed' | 'aborted' | 'left') => void
}) {
  return (
    <BulkClassificationModal
      session={props.session}
      targets={props.targets ?? props.session.common.targets}
      classifiedTransactionIds={
        props.classifiedTransactionIds ?? props.session.classifiedTransactionIds
      }
      onClose={props.onClose}
    />
  )
}

function renderWithClient(element: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>)
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
      { merchantName: 'スーパーA', head: targets[0], targets: [targets[0], targets[2]] },
      { merchantName: 'カフェB', head: targets[1], targets: [targets[1]] },
    ])
  })
})

describe('BulkClassificationModal', () => {
  it('加盟店ごとにまとめて表示し、同一加盟店の件数を示す', async () => {
    renderWithClient(
      <ModalUnderTest
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

  it('カテゴリ未選択では分類できず、押せない理由を画面に出す', async () => {
    renderWithClient(
      <ModalUnderTest
        session={session([{ transactionId: 'TX1', merchantName: 'スーパーA' }])}
        onClose={vi.fn()}
      />,
    )

    // 選択肢が出そろうまでは「選べ」と促さない（選ぶものが無い状態で理由だけ出さない）
    expect(screen.queryByText('カテゴリを選ぶと分類できます')).not.toBeInTheDocument()
    await screen.findByRole('option', { name: '食費' })

    expect(screen.getByRole('button', { name: 'この店舗の 1 件を分類' })).toBeDisabled()
    expect(screen.getByText('カテゴリを選ぶと分類できます')).toBeInTheDocument()
  })

  it('経費(会社) は経費種別を選ぶまで分類できない', async () => {
    const user = userEvent.setup()
    renderWithClient(
      <ModalUnderTest
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
      <ModalUnderTest
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

  it('分類し終えた加盟店の取引をセッションの進捗として記録する', async () => {
    const user = userEvent.setup()
    renderWithClient(
      <ModalUnderTest
        session={session([
          { transactionId: 'TX1', merchantName: 'スーパーA' },
          { transactionId: 'TX2', merchantName: 'スーパーA' },
          { transactionId: 'TX3', merchantName: 'カフェB' },
        ])}
        onClose={vi.fn()}
      />,
    )

    await classifyCurrentGroup(user)

    await waitFor(() =>
      expect(apiMock.apiMutate).toHaveBeenCalledWith(
        '/api/classification/bulk-sessions/BCS_1/progress',
        { method: 'POST', body: { transactionIds: ['TX1', 'TX2'] } },
        expect.anything(),
      ),
    )
  })

  it('分類が全件終わってから進捗を送る（分類が失敗したら送らない）', async () => {
    const user = userEvent.setup()
    apiMock.apiMutate.mockImplementation((path: string) =>
      path === '/api/transactions/TX2/classify'
        ? Promise.reject(new Error('boom'))
        : Promise.resolve({}),
    )
    renderWithClient(
      <ModalUnderTest
        session={session([
          { transactionId: 'TX1', merchantName: 'スーパーA' },
          { transactionId: 'TX2', merchantName: 'スーパーA' },
        ])}
        onClose={vi.fn()}
      />,
    )

    await classifyCurrentGroup(user)

    // 2 件目が失敗したので、この加盟店は分類し終えていない
    expect(await screen.findByRole('alert')).toHaveTextContent('分類の保存に失敗しました。')
    expect(apiMock.apiMutate).not.toHaveBeenCalledWith(
      '/api/classification/bulk-sessions/BCS_1/progress',
      expect.anything(),
      expect.anything(),
    )
  })

  it('とばした加盟店は、次の加盟店を分類したときの進捗にも混ざらない', async () => {
    const user = userEvent.setup()
    renderWithClient(
      <ModalUnderTest
        session={session([
          { transactionId: 'TX1', merchantName: 'スーパーA' },
          { transactionId: 'TX2', merchantName: 'カフェB' },
        ])}
        onClose={vi.fn()}
      />,
    )

    await user.click(await screen.findByRole('button', { name: 'この店舗はとばす' }))
    expect(await screen.findByText('カフェB')).toBeInTheDocument()
    await classifyCurrentGroup(user)

    await waitFor(() =>
      expect(apiMock.apiMutate).toHaveBeenCalledWith(
        '/api/classification/bulk-sessions/BCS_1/progress',
        { method: 'POST', body: { transactionIds: ['TX2'] } },
        expect.anything(),
      ),
    )
  })

  it('進捗の記録に失敗しても分類は確定済みとして次へ進み、次の記録で送り直す', async () => {
    const user = userEvent.setup()
    let progressCalls = 0
    apiMock.apiMutate.mockImplementation((path: string) => {
      if (path.endsWith('/progress')) {
        progressCalls++
        if (progressCalls === 1) return Promise.reject(new Error('boom'))
      }
      return Promise.resolve({})
    })
    renderWithClient(
      <ModalUnderTest
        session={session([
          { transactionId: 'TX1', merchantName: 'スーパーA' },
          { transactionId: 'TX2', merchantName: 'カフェB' },
        ])}
        onClose={vi.fn()}
      />,
    )

    await classifyCurrentGroup(user)

    // 記録が失敗しても分類は確定済みなので、件数は巻き戻らずエラーも出さない
    expect(await screen.findByText('2 / 2 店舗（分類済み 1 件）')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await classifyCurrentGroup(user)

    // 2 回目は累積を送るので、取りこぼした TX1 もここで記録される
    await waitFor(() =>
      expect(apiMock.apiMutate).toHaveBeenCalledWith(
        '/api/classification/bulk-sessions/BCS_1/progress',
        { method: 'POST', body: { transactionIds: ['TX1', 'TX2'] } },
        expect.anything(),
      ),
    )
  })

  it('再開したセッションでは、引き継いだ分類済みも累積に含めて送る', async () => {
    const user = userEvent.setup()
    const full = session([
      { transactionId: 'TX1', merchantName: 'スーパーA' },
      { transactionId: 'TX2', merchantName: 'カフェB' },
    ])
    renderWithClient(
      <ModalUnderTest
        session={full}
        targets={full.common.targets.filter(target => target.transactionId === 'TX2')}
        classifiedTransactionIds={['TX1']}
        onClose={vi.fn()}
      />,
    )

    // 分類済みの件数はセッション全体で数える（開いた分だけではない）
    expect(await screen.findByText('1 / 1 店舗（分類済み 1 件）')).toBeInTheDocument()

    await classifyCurrentGroup(user)

    await waitFor(() =>
      expect(apiMock.apiMutate).toHaveBeenCalledWith(
        '/api/classification/bulk-sessions/BCS_1/progress',
        { method: 'POST', body: { transactionIds: ['TX1', 'TX2'] } },
        expect.anything(),
      ),
    )
  })

  it('完了の件数は画面で数えた件数ではなくサーバーの処理件数を出す', async () => {
    const user = userEvent.setup()
    const targets = [
      { transactionId: 'TX1', merchantName: 'スーパーA' },
      { transactionId: 'TX2', merchantName: 'スーパーA' },
      { transactionId: 'TX3', merchantName: 'カフェB' },
    ]
    apiMock.apiMutate.mockImplementation((path: string) => {
      if (path.endsWith('/complete')) {
        return Promise.resolve(
          BulkClassificationSessionWireSchema.parse({
            kind: 'completed',
            common: session(targets).common,
            startedAt: '2026-07-24T00:00:00.000Z',
            completedAt: '2026-07-24T00:10:00.000Z',
            // 画面側のどの値（対象 3 件 / 加盟店 2 件 / 分類済み 3 件）とも一致しない値
            processedCount: 5,
          }),
        )
      }
      return Promise.resolve({})
    })
    renderWithClient(<ModalUnderTest session={session(targets)} onClose={vi.fn()} />)

    await classifyCurrentGroup(user)
    await screen.findByText('カフェB')
    await classifyCurrentGroup(user)

    expect(
      await screen.findByText('5 件を分類しました。同じ店舗の取引は次回から自動で分類されます。', {
        exact: false,
      }),
    ).toBeInTheDocument()
    expect(apiMock.apiMutate).toHaveBeenCalledWith(
      '/api/classification/bulk-sessions/BCS_1/complete',
      { method: 'POST' },
      expect.anything(),
    )
  })

  it('学習されない加盟店だけを分類したときは「次回から自動で分類」と言わない', async () => {
    const user = userEvent.setup()
    const targets = [
      { transactionId: 'TX1', merchantName: 'AMAZON.CO.JP', reason: 'amazon_match_timeout' },
    ]
    apiMock.apiMutate.mockImplementation((path: string) => {
      if (path.endsWith('/complete')) {
        return Promise.resolve(
          BulkClassificationSessionWireSchema.parse({
            kind: 'completed',
            common: session(targets).common,
            startedAt: '2026-07-24T00:00:00.000Z',
            completedAt: '2026-07-24T00:10:00.000Z',
            processedCount: 1,
          }),
        )
      }
      return Promise.resolve({})
    })
    renderWithClient(<ModalUnderTest session={session(targets)} onClose={vi.fn()} />)

    // 未分類理由も、加盟店ルールの学習に結び付かない理由がそのまま出る
    expect(screen.getByText('Amazon の注文と結び付けられませんでした')).toBeInTheDocument()

    await classifyCurrentGroup(user)

    expect(await screen.findByText('1 件を分類しました。')).toBeInTheDocument()
    expect(screen.queryByText(/次回から自動で分類されます/)).not.toBeInTheDocument()
  })

  it('全部の加盟店をとばしてもセッションは完了する', async () => {
    const user = userEvent.setup()
    apiMock.apiMutate.mockImplementation((path: string) => {
      if (path.endsWith('/complete')) {
        return Promise.resolve(
          BulkClassificationSessionWireSchema.parse({
            kind: 'completed',
            common: session([{ transactionId: 'TX1', merchantName: 'スーパーA' }]).common,
            startedAt: '2026-07-24T00:00:00.000Z',
            completedAt: '2026-07-24T00:10:00.000Z',
            processedCount: 0,
          }),
        )
      }
      return Promise.resolve({})
    })
    renderWithClient(
      <ModalUnderTest
        session={session([{ transactionId: 'TX1', merchantName: 'スーパーA' }])}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'この店舗はとばす' }))

    expect(await screen.findByText('0 件を分類しました。')).toBeInTheDocument()
    expect(apiMock.apiMutate).toHaveBeenCalledWith(
      '/api/classification/bulk-sessions/BCS_1/complete',
      { method: 'POST' },
      expect.anything(),
    )
  })

  it('対象が残っていないセッションは、完了させる導線だけを出す', async () => {
    const user = userEvent.setup()
    const empty = {
      ...session([{ transactionId: 'TX1', merchantName: 'スーパーA' }]),
      common: {
        ...session([{ transactionId: 'TX1', merchantName: 'スーパーA' }]).common,
        targets: [],
      },
    }
    apiMock.apiMutate.mockImplementation((path: string) => {
      if (path.endsWith('/complete')) {
        return Promise.resolve(
          BulkClassificationSessionWireSchema.parse({
            kind: 'completed',
            common: empty.common,
            startedAt: '2026-07-24T00:00:00.000Z',
            completedAt: '2026-07-24T00:10:00.000Z',
            processedCount: 2,
          }),
        )
      }
      return Promise.resolve({})
    })
    renderWithClient(<ModalUnderTest session={empty} onClose={vi.fn()} />)

    expect(
      screen.getByText('分類する取引が残っていません。このまとめて分類をおえてください。'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'まとめて分類をおえる' }))

    expect(await screen.findByText('2 件を分類しました。', { exact: false })).toBeInTheDocument()
  })

  it('完了に失敗したら結果を出さず、やり直しの手段を示す', async () => {
    const user = userEvent.setup()
    apiMock.apiMutate.mockImplementation((path: string) => {
      if (path.endsWith('/complete')) return Promise.reject(new Error('boom'))
      return Promise.resolve({})
    })
    renderWithClient(
      <ModalUnderTest
        session={session([{ transactionId: 'TX1', merchantName: 'スーパーA' }])}
        onClose={vi.fn()}
      />,
    )

    await classifyCurrentGroup(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'おえられませんでした。通信状態を確かめて、「この店舗はとばす」でもう一度お試しください。',
    )
    expect(screen.queryByText(/件を分類しました/)).not.toBeInTheDocument()
  })

  it('とばした加盟店は分類されない', async () => {
    const user = userEvent.setup()
    renderWithClient(
      <ModalUnderTest
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
      <ModalUnderTest
        session={session([
          { transactionId: 'TX1', merchantName: 'スーパーA' },
          { transactionId: 'TX2', merchantName: 'カフェB' },
        ])}
        onClose={vi.fn()}
      />,
    )

    await classifyCurrentGroup(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '分類の保存に失敗しました。通信状態を確かめて、もう一度「この店舗の 1 件を分類」を押してください。',
    )
    expect(screen.getByText('スーパーA')).toBeInTheDocument()
    expect(screen.queryByText('カフェB')).not.toBeInTheDocument()
    // 失敗した件数を分類済みに数え上げない
    expect(screen.getByText('1 / 2 店舗（分類済み 0 件）')).toBeInTheDocument()
  })

  it('同一加盟店の 2 件目が失敗しても、成功した 1 件目は分類済みのまま次に進まない', async () => {
    const user = userEvent.setup()
    apiMock.apiMutate.mockImplementation((path: string) => {
      if (path === '/api/transactions/TX2/classify') return Promise.reject(new Error('boom'))
      return Promise.resolve({})
    })
    renderWithClient(
      <ModalUnderTest
        session={session([
          { transactionId: 'TX1', merchantName: 'スーパーA' },
          { transactionId: 'TX2', merchantName: 'スーパーA' },
          { transactionId: 'TX3', merchantName: 'カフェB' },
        ])}
        onClose={vi.fn()}
      />,
    )

    await classifyCurrentGroup(user)

    await screen.findByRole('alert')
    // 1 件目は保存済み。再実行すると 1 件目は再分類（冪等）され 2 件目が確定する
    expect(apiMock.apiMutate).toHaveBeenCalledWith(
      '/api/transactions/TX1/classify',
      expect.objectContaining({ method: 'PUT' }),
      expect.anything(),
    )
    expect(screen.getByText('スーパーA')).toBeInTheDocument()
    expect(screen.queryByText('カフェB')).not.toBeInTheDocument()
  })

  it('やめる確認の件数には、とばした加盟店の取引も含まれる', async () => {
    const user = userEvent.setup()
    renderWithClient(
      <ModalUnderTest
        session={session([
          { transactionId: 'TX1', merchantName: 'スーパーA' },
          { transactionId: 'TX2', merchantName: 'カフェB' },
          { transactionId: 'TX3', merchantName: '書店C' },
        ])}
        onClose={vi.fn()}
      />,
    )

    // 1 店舗目をとばし、2 店舗目を分類する（とばした 1 件は未分類のまま残る）
    await user.click(await screen.findByRole('button', { name: 'この店舗はとばす' }))
    expect(await screen.findByText('カフェB')).toBeInTheDocument()
    await classifyCurrentGroup(user)
    expect(await screen.findByText('書店C')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'まとめて分類をやめる' }))

    // 残るのは とばした TX1 と、まだ見ていない TX3 の 2 件
    expect(screen.getByText(/まだ分類していない 2 件は未分類のままになり/)).toBeInTheDocument()
  })

  it('「まとめて分類をやめる」でセッションを中断する', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderWithClient(
      <ModalUnderTest
        session={session([{ transactionId: 'TX1', merchantName: 'スーパーA' }])}
        onClose={onClose}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'まとめて分類をやめる' }))
    // 取りやめは再開できないため、影響を示して確認してから実行する
    expect(screen.getByText(/まだ分類していない 1 件は未分類のままになり/)).toBeInTheDocument()
    expect(apiMock.apiMutate).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'やめる' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledWith('aborted'))
    expect(apiMock.apiMutate).toHaveBeenCalledWith(
      '/api/classification/bulk-sessions/BCS_1/abort',
      { method: 'POST' },
      expect.anything(),
    )
  })

  it('取りやめの確認から分類に戻れる（誤操作しても中断されない）', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderWithClient(
      <ModalUnderTest
        session={session([{ transactionId: 'TX1', merchantName: 'スーパーA' }])}
        onClose={onClose}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'まとめて分類をやめる' }))
    await user.click(screen.getByRole('button', { name: '分類に戻る' }))

    expect(screen.getByText('スーパーA')).toBeInTheDocument()
    expect(apiMock.apiMutate).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('取りやめに失敗したら閉じずにエラーを出す', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    apiMock.apiMutate.mockRejectedValue(new Error('boom'))
    renderWithClient(
      <ModalUnderTest
        session={session([{ transactionId: 'TX1', merchantName: 'スーパーA' }])}
        onClose={onClose}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'まとめて分類をやめる' }))
    await user.click(screen.getByRole('button', { name: 'やめる' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '取りやめられませんでした。通信状態を確かめて、もう一度お試しください。',
    )
    expect(onClose).not.toHaveBeenCalled()
  })

  it('「あとで続ける」はセッションを中断せずに閉じる（再開できる）', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderWithClient(
      <ModalUnderTest
        session={session([{ transactionId: 'TX1', merchantName: 'スーパーA' }])}
        onClose={onClose}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'あとで続ける' }))

    expect(onClose).toHaveBeenCalledWith('left')
    expect(apiMock.apiMutate).not.toHaveBeenCalled()
  })
})
