/**
 * 取込画面の結線（形式の判別 → 送信先の振り分け → 失敗の翻訳）を固定する。
 * 部品側（import-upload / ImportJobCard）の単体テストでは、
 * 「選んだ形式で実際に送り先が変わるか」までは担保できないため。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ImportsPage from '../page'
import { ApiError } from '@/lib/api-client'

const apiFetch = vi.fn()
const apiMutate = vi.fn()

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('month=2026-06'),
}))

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client')
  return {
    ...actual,
    apiFetch: (path: string, schema: { parse: (input: unknown) => unknown }) =>
      apiFetch(path, schema),
    apiMutate: (
      path: string,
      options: { method: string; body?: unknown },
      schema: { parse: (input: unknown) => unknown },
    ) => apiMutate(path, options, schema),
  }
})

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ImportsPage />
    </QueryClientProvider>,
  )
}

function selectFile(name: string, type: string, size = 10): void {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')
  if (input === null) throw new Error('ファイル入力が見つからない')
  const file = new File(['x'.repeat(size)], name, { type })
  fireEvent.change(input, { target: { files: [file] } })
}

function completedJobResponse(): unknown {
  return {
    job: {
      kind: 'completed',
      common: {
        importJobId: '01JOB',
        targetMonth: '2026-06',
        fileKind: 'card_statement',
        fileFormat: 'pdf',
        fileRef: '01FILE',
      },
      summary: {
        newCount: 3,
        autoClassifiedEstimateCount: 0,
        unclassifiedEstimateCount: 3,
        duplicateExcludedCount: 0,
      },
    },
  }
}

beforeEach(() => {
  apiFetch.mockReset()
  apiMutate.mockReset()
  apiFetch.mockResolvedValue({ completion: null })
  apiMutate.mockResolvedValue(completedJobResponse())
})

describe('取込画面のアップロード', () => {
  it('PDF を選ぶと PDF 取込エンドポイントへ送る', async () => {
    renderPage()
    selectFile('statement.pdf', 'application/pdf')

    await waitFor(() => expect(apiMutate).toHaveBeenCalledTimes(1))
    expect(apiMutate.mock.calls[0]?.[0]).toBe('/api/imports/pdf')
    const body = apiMutate.mock.calls[0]?.[1]?.body as FormData
    expect(body.get('targetMonth')).toBe('2026-06')
  })

  it('CSV を選ぶと CSV 取込エンドポイントへ送る', async () => {
    renderPage()
    selectFile('statement.csv', 'text/csv')

    await waitFor(() => expect(apiMutate).toHaveBeenCalledTimes(1))
    expect(apiMutate.mock.calls[0]?.[0]).toBe('/api/imports/csv')
  })

  it('対応外のファイルは送らずにその場で断る', async () => {
    renderPage()
    selectFile('photo.png', 'image/png')

    expect(await screen.findByRole('alert')).toHaveTextContent('取込できるのは CSV')
    expect(apiMutate).not.toHaveBeenCalled()
  })

  it('上限を超える PDF は送らずにサイズを理由に断る', async () => {
    renderPage()
    selectFile('statement.pdf', 'application/pdf', 10_000_001)

    expect(await screen.findByRole('alert')).toHaveTextContent('10MB')
    expect(apiMutate).not.toHaveBeenCalled()
  })

  it('変換失敗（422）は失敗ジョブとして理由つきで表示する', async () => {
    apiMutate.mockRejectedValue(
      new ApiError(
        422,
        JSON.stringify({
          job: {
            kind: 'failed',
            common: {
              importJobId: '01JOB',
              targetMonth: '2026-06',
              fileKind: 'card_statement',
              fileFormat: 'pdf',
              fileRef: '01FILE',
            },
            failureReason: {
              kind: 'pdf_conversion_failed',
              reason: 'total_amount_mismatch',
              failureDetail: '合計金額が一致しない',
            },
          },
        }),
      ),
    )
    renderPage()
    selectFile('statement.pdf', 'application/pdf')

    expect(await screen.findByText('失敗')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('合計金額が PDF の記載と一致しませんでした')
  })

  it('PDF として読み取れない場合（400 + reason）は選び直しを促す', async () => {
    apiMutate.mockRejectedValue(
      new ApiError(400, JSON.stringify({ error: 'file が PDF ではない', reason: 'not_a_pdf' })),
    )
    renderPage()
    selectFile('statement.pdf', 'application/pdf')

    expect(await screen.findByRole('alert')).toHaveTextContent('PDF として読み取れないファイル')
  })

  it('理由の無い 400 では PDF の中身のせいだと決めつけない', async () => {
    apiMutate.mockRejectedValue(new ApiError(400, JSON.stringify({ error: 'Validation error' })))
    renderPage()
    selectFile('statement.pdf', 'application/pdf')

    const alert = await screen.findByRole('alert')
    expect(alert).not.toHaveTextContent('PDF として読み取れないファイル')
    expect(alert).toHaveTextContent('アップロードを受け付けられませんでした')
  })

  it('取込完了では件数サマリを表示する', async () => {
    renderPage()
    selectFile('statement.pdf', 'application/pdf')

    expect(await screen.findByText('新規候補: 3 件')).toBeInTheDocument()
  })
})
