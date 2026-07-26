import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  apiMutate: vi.fn(),
}))
vi.mock('@/lib/api-client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>()
  return { ...apiMock, ApiError: actual.ApiError }
})

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('month=2026-07'),
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

const ImportsPage = (await import('../page')).default

const IMPORT_JOB_ID = '01JEEEEEEEEEEEEEEEEEEEEEE1'

const completedJob = {
  kind: 'completed',
  common: {
    importJobId: IMPORT_JOB_ID,
    targetMonth: '2026-07',
    fileKind: 'card_statement',
    fileFormat: 'csv',
    fileRef: 'ref',
  },
  summary: {
    newCount: 10,
    autoClassifiedEstimateCount: 7,
    unclassifiedEstimateCount: 3,
    duplicateExcludedCount: 2,
  },
}

beforeEach(() => {
  apiMock.apiFetch.mockImplementation((path: string) => {
    if (path.startsWith('/api/imports/status')) return Promise.resolve({ completion: null })
    if (path.endsWith('/candidates')) {
      return Promise.resolve({ importJobId: IMPORT_JOB_ID, jobKind: 'completed', candidates: [] })
    }
    throw new Error(`unexpected apiFetch: ${path}`)
  })
  apiMock.apiMutate.mockImplementation((path: string) => {
    if (path === '/api/imports/csv') return Promise.resolve({ job: completedJob })
    throw new Error(`unexpected apiMutate: ${path}`)
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ImportsPage />
    </QueryClientProvider>,
  )
}

/** CSV を 1 本アップロードして取込ジョブの表示まで進める */
async function uploadCsv(user: ReturnType<typeof userEvent.setup>, container: HTMLElement) {
  const input = container.querySelector('input[type="file"]')
  await user.upload(input as HTMLInputElement, new File(['日付,店名,金額'], 'a.csv'))
}

describe('CSV 取込画面の取込サマリ', () => {
  it('新規・自動分類・未分類・重複除外の内訳を出す（AT-302 手順1）', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()

    await uploadCsv(user, container)

    expect(await screen.findByText('新規候補: 10 件')).toBeInTheDocument()
    expect(screen.getByText('自動分類の見込み: 7 件')).toBeInTheDocument()
    expect(screen.getByText('未分類の見込み: 3 件')).toBeInTheDocument()
    expect(screen.getByText('重複除外: 2 件')).toBeInTheDocument()
  })

  it('確定後の導線は、対象月と取込ジョブを引き継いで取引一覧へ送る', async () => {
    const user = userEvent.setup()
    apiMock.apiMutate.mockImplementation((path: string) => {
      if (path === '/api/imports/csv') return Promise.resolve({ job: completedJob })
      if (path.endsWith('/confirm')) {
        return Promise.resolve({
          importJobId: IMPORT_JOB_ID,
          confirmedCount: 3,
          alreadyConfirmedCount: 0,
          confirmedAt: new Date('2026-07-24T00:00:00.000Z'),
        })
      }
      throw new Error(`unexpected apiMutate: ${path}`)
    })
    apiMock.apiFetch.mockImplementation((path: string) => {
      if (path.startsWith('/api/imports/status')) return Promise.resolve({ completion: null })
      if (path.endsWith('/candidates')) {
        return Promise.resolve({
          importJobId: IMPORT_JOB_ID,
          jobKind: 'completed',
          candidates: [
            {
              kind: 'normal',
              common: {
                transactionCandidateId: 'TC1',
                userId: 'U_DARLING',
                merchantName: 'スーパーA',
                amount: 1200,
                occurredAt: new Date('2026-07-10T00:00:00.000Z'),
              },
            },
          ],
        })
      }
      throw new Error(`unexpected apiFetch: ${path}`)
    })
    const { container } = renderPage()

    await uploadCsv(user, container)
    await user.click(await screen.findByRole('button', { name: 'すべて確定する' }))

    const link = await screen.findByRole('link', { name: '取引一覧でまとめて分類する' })
    await waitFor(() =>
      // 取込起因（CSV取込ID）を引き継ぐ。一括分類はこの ID でセッションを開始する
      expect(link).toHaveAttribute(
        'href',
        `/transactions?month=2026-07&importJobId=${IMPORT_JOB_ID}`,
      ),
    )
  })
})
