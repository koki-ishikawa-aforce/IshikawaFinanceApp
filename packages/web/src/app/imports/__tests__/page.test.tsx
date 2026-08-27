/**
 * 取込画面の結線（形式の判別 → 送信先の振り分け → 失敗の翻訳）を固定する。
 * 部品側（import-upload / ImportJobCard）の単体テストでは、
 * 「選んだ形式で実際に送り先が変わるか」までは担保できないため。
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ImportsPage from '../page'
import { ApiError, NetworkError, NETWORK_ERROR_MESSAGE, UPLOAD_TIMEOUT_MS } from '@/lib/api-client'

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
      options: { method: string; body?: unknown; timeoutMs?: number },
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

  it('種別を選ばなければカード利用明細として送る', async () => {
    renderPage()
    selectFile('statement.csv', 'text/csv')

    await waitFor(() => expect(apiMutate).toHaveBeenCalledTimes(1))
    const body = apiMutate.mock.calls[0]?.[1]?.body as FormData
    expect(body.get('fileKind')).toBe('card_statement')
  })

  it('種別を銀行入出金明細に切り替えるとその種別で送る', async () => {
    // 送信側が既定値を持つため、切り替えが送信に載らなくてもエラーにはならず、
    // 銀行の明細がカードの明細として取り込まれる。ここで結線を固定する
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('radio', { name: '銀行入出金明細' }))
    selectFile('statement.csv', 'text/csv')

    await waitFor(() => expect(apiMutate).toHaveBeenCalledTimes(1))
    const body = apiMutate.mock.calls[0]?.[1]?.body as FormData
    expect(body.get('fileKind')).toBe('bank_statement')
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

describe('通信できないときのアップロード', () => {
  it('通信の失敗は全画面共通の文言で伝える', async () => {
    apiMutate.mockRejectedValue(new NetworkError('unreachable'))
    renderPage()
    selectFile('statement.pdf', 'application/pdf')

    expect(await screen.findByRole('alert')).toHaveTextContent(NETWORK_ERROR_MESSAGE)
  })

  it('通信の失敗はアップロード固有の説明で包まない（同じ失敗が画面ごとに違う文言にならないように）', async () => {
    apiMutate.mockRejectedValue(new NetworkError('timeout'))
    renderPage()
    selectFile('statement.pdf', 'application/pdf')

    const alert = await screen.findByRole('alert')
    expect(alert).not.toHaveTextContent('アップロードに失敗しました')
    expect(alert.textContent).toBe(NETWORK_ERROR_MESSAGE)
  })

  it('失敗したら選び直さずに送り直せる', async () => {
    // 送信後にファイル選択の input は空にしているため、画面が直前のファイルを覚えていないと
    // 再試行のたびに端末のファイル選択からやり直しになる
    const user = userEvent.setup()
    apiMutate.mockRejectedValueOnce(new NetworkError('unreachable'))
    renderPage()
    selectFile('statement.pdf', 'application/pdf')

    await user.click(await screen.findByRole('button', { name: 'もう一度アップロード' }))

    await waitFor(() => expect(apiMutate).toHaveBeenCalledTimes(2))
    expect(apiMutate.mock.calls[1]?.[0]).toBe('/api/imports/pdf')
    const body = apiMutate.mock.calls[1]?.[1]?.body as FormData
    expect((body.get('file') as File).name).toBe('statement.pdf')
    expect(await screen.findByText('新規候補: 3 件')).toBeInTheDocument()
  })

  it('送り直しは送ったときの対象月・ファイル種別のまま送る', async () => {
    // 現在値を見て送り直すと、失敗後に月を切り替えてから押したときに
    // 選んだ覚えのない月へ取り込まれ、銀行明細がカード明細として入る
    const user = userEvent.setup()
    apiMutate.mockRejectedValueOnce(new NetworkError('unreachable'))
    renderPage()

    await user.click(screen.getByRole('radio', { name: '銀行入出金明細' }))
    selectFile('statement.csv', 'text/csv')
    await user.click(await screen.findByRole('button', { name: 'もう一度アップロード' }))

    await waitFor(() => expect(apiMutate).toHaveBeenCalledTimes(2))
    const body = apiMutate.mock.calls[1]?.[1]?.body as FormData
    expect(body.get('fileKind')).toBe('bank_statement')
    expect(body.get('targetMonth')).toBe('2026-06')
  })

  it('送り直しの前に月を変えても、送ったときの月へ送る', async () => {
    const user = userEvent.setup()
    apiMutate.mockRejectedValueOnce(new NetworkError('unreachable'))
    renderPage()
    selectFile('statement.csv', 'text/csv')

    await screen.findByRole('button', { name: 'もう一度アップロード' })
    await user.click(screen.getByRole('button', { name: '前月' }))
    await user.click(screen.getByRole('button', { name: 'もう一度アップロード' }))

    await waitFor(() => expect(apiMutate).toHaveBeenCalledTimes(2))
    const body = apiMutate.mock.calls[1]?.[1]?.body as FormData
    expect(body.get('targetMonth')).toBe('2026-06')
  })

  it('送信の失敗が残っているときに対応外ファイルを選んだら、送り直しは消える', async () => {
    // 残したままだと「別のファイルを選び直してください」の隣に送り直しが並び、
    // 押すと今選んだファイルではなく前回のファイルが飛ぶ
    apiMutate.mockRejectedValueOnce(new NetworkError('unreachable'))
    renderPage()
    selectFile('statement.pdf', 'application/pdf')
    await screen.findByRole('button', { name: 'もう一度アップロード' })

    selectFile('photo.png', 'image/png')

    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'もう一度アップロード' }),
      ).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('alert')).toHaveTextContent('取込できるのは CSV')
  })

  it('送信中も送り直しの導線を残す（押した瞬間に消してフォーカスを失わせない）', async () => {
    const user = userEvent.setup()
    apiMutate.mockRejectedValueOnce(new NetworkError('unreachable'))
    let resolveUpload: ((value: unknown) => void) | undefined
    apiMutate.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveUpload = resolve
        }),
    )
    renderPage()
    selectFile('statement.pdf', 'application/pdf')

    await user.click(await screen.findByRole('button', { name: 'もう一度アップロード' }))

    const retrying = await screen.findByRole('button', { name: 'アップロード中...' })
    expect(retrying).toBeDisabled()
    await act(async () => {
      resolveUpload?.(completedJobResponse())
    })
  })

  it('送り直しが成功したら送り直しの導線は消える', async () => {
    const user = userEvent.setup()
    apiMutate.mockRejectedValueOnce(new NetworkError('unreachable'))
    renderPage()
    selectFile('statement.pdf', 'application/pdf')

    await user.click(await screen.findByRole('button', { name: 'もう一度アップロード' }))

    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'もう一度アップロード' }),
      ).not.toBeInTheDocument(),
    )
  })

  it('送らずに断った選択には送り直しを出さない（同じファイルでは結果が変わらないため）', async () => {
    renderPage()
    selectFile('photo.png', 'image/png')

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'もう一度アップロード' })).not.toBeInTheDocument()
  })

  it('アップロードには既定より長い打ち切り時間を渡す（PDF の変換を待つため）', async () => {
    renderPage()
    selectFile('statement.pdf', 'application/pdf')

    await waitFor(() => expect(apiMutate).toHaveBeenCalledTimes(1))
    const timeoutMs = (apiMutate.mock.calls[0]?.[1] as { timeoutMs?: number }).timeoutMs
    expect(timeoutMs).toBe(UPLOAD_TIMEOUT_MS)
  })

  it('取込状況の取得が通信で失敗した場合も共通の文言で伝える', async () => {
    apiFetch.mockRejectedValue(new NetworkError('unreachable'))
    renderPage()

    expect(await screen.findByText(NETWORK_ERROR_MESSAGE)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeInTheDocument()
    // この月の取込状況カードは常時マウントの role="status" で包む(docs/design/usability.md
    // 8-4)ため、中のエラーは alert を作らず polite で通知される
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
