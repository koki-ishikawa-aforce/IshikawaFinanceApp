import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

// vi.resetModules() 後もモジュール再評価で同一インスタンスが返るよう hoisted で共有する
const liffMock = vi.hoisted(() => ({
  isLiffEnabled: vi.fn((): boolean => false),
  getIdToken: vi.fn((): string | null => null),
}))

vi.mock('@/lib/liff', () => liffMock)

// BASE_URL / DEV_USER_ID はモジュール読み込み時に process.env から確定するため、
// 実行環境の NEXT_PUBLIC_* に依存しないよう env を消してから再評価する
type ApiClient = typeof import('../api-client')
let api: ApiClient

beforeAll(async () => {
  delete process.env['NEXT_PUBLIC_API_URL']
  delete process.env['NEXT_PUBLIC_USER_ID']
  vi.resetModules()
  api = await import('../api-client')
})

const fetchMock = vi.fn()

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  liffMock.isLiffEnabled.mockReturnValue(false)
  liffMock.getIdToken.mockReturnValue(null)
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('apiFetch', () => {
  it('スキーマで parse した結果を返す', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { value: 42 }))

    const result = await api.apiFetch('/api/test', z.object({ value: z.number() }))

    expect(result).toEqual({ value: 42 })
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:3001/api/test')
  })

  it('LIFF 無効時は X-User-Id ヘッダを送る', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}))

    await api.apiFetch('/api/test', z.object({}))

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.headers).toEqual({ 'X-User-Id': 'U_DARLING_DEV' })
  })

  it('LIFF 有効かつトークンありなら Authorization ヘッダを送る', async () => {
    liffMock.isLiffEnabled.mockReturnValue(true)
    liffMock.getIdToken.mockReturnValue('token-123')
    fetchMock.mockResolvedValue(jsonResponse(200, {}))

    await api.apiFetch('/api/test', z.object({}))

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.headers).toEqual({ Authorization: 'Bearer token-123' })
  })

  it('LIFF 有効でもトークンがなければ X-User-Id にフォールバックする', async () => {
    liffMock.isLiffEnabled.mockReturnValue(true)
    liffMock.getIdToken.mockReturnValue(null)
    fetchMock.mockResolvedValue(jsonResponse(200, {}))

    await api.apiFetch('/api/test', z.object({}))

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.headers).toEqual({ 'X-User-Id': 'U_DARLING_DEV' })
  })

  it('非 2xx なら ApiError を投げる（error フィールドがメッセージまで伝わる）', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: 'not found' }))

    await expect(api.apiFetch('/api/test', z.object({}))).rejects.toThrow('not found')
  })

  it('スキーマ不一致なら ZodError を投げる', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { value: 'string' }))

    await expect(api.apiFetch('/api/test', z.object({ value: z.number() }))).rejects.toThrowError(
      z.ZodError,
    )
  })
})

describe('apiMutate', () => {
  it('JSON ボディを Content-Type 付きで送る', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }))

    const result = await api.apiMutate(
      '/api/test',
      { method: 'POST', body: { name: 'test' } },
      z.object({ ok: z.boolean() }),
    )

    expect(result).toEqual({ ok: true })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(init.body).toBe(JSON.stringify({ name: 'test' }))
  })

  it('FormData は Content-Type を付けずそのまま送る', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}))
    const formData = new FormData()
    formData.append('file', new Blob(['csv']), 'test.csv')

    await api.apiMutate('/api/test', { method: 'POST', body: formData }, z.object({}))

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.body).toBe(formData)
    expect(init.headers).not.toMatchObject({ 'Content-Type': expect.anything() })
  })

  it('body なしの DELETE を送れる', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}))

    await api.apiMutate('/api/test/1', { method: 'DELETE' }, z.object({}))

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('DELETE')
    expect(init.body).toBeUndefined()
  })

  it('空レスポンスは null として parse する', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 200 }))

    const result = await api.apiMutate('/api/test', { method: 'DELETE' }, z.null())

    expect(result).toBeNull()
  })

  it('非 2xx なら ApiError を投げる', async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { error: 'conflict' }))

    await expect(
      api.apiMutate('/api/test', { method: 'PUT', body: {} }, z.object({})),
    ).rejects.toThrow('conflict')
  })
})

describe('ApiError', () => {
  it('JSON ボディの error をエラーメッセージに使う（サーバーの errorHandler が返す形）', () => {
    const error = new api.ApiError(400, JSON.stringify({ error: '入力が不正です' }))
    expect(error.message).toBe('入力が不正です')
    expect(error.status).toBe(400)
  })

  it('error が無ければ message をエラーメッセージに使う', () => {
    const error = new api.ApiError(400, JSON.stringify({ message: '入力が不正です' }))
    expect(error.message).toBe('入力が不正です')
  })

  it('error と message が両方あれば error を優先する', () => {
    const error = new api.ApiError(
      400,
      JSON.stringify({ error: 'サーバー起因のエラー', message: '無視されるべき文言' }),
    )
    expect(error.message).toBe('サーバー起因のエラー')
  })

  it('error が文字列でなければ message にフォールバックする', () => {
    const error = new api.ApiError(
      400,
      JSON.stringify({ error: 123, message: 'フォールバック文言' }),
    )
    expect(error.message).toBe('フォールバック文言')
  })

  it('JSON でないボディはそのままメッセージに使う', () => {
    const error = new api.ApiError(500, 'Internal Server Error')
    expect(error.message).toBe('Internal Server Error')
  })

  it('空ボディならステータス入りの既定メッセージを使う', () => {
    const error = new api.ApiError(502, '')
    expect(error.message).toBe('API error 502')
  })

  it('error / message のどちらも無ければボディ全体を使う', () => {
    const body = JSON.stringify({ details: 'not found' })
    const error = new api.ApiError(404, body)
    expect(error.message).toBe(body)
  })

  it('error フィールドが文字列でなければボディ全体を使う', () => {
    const body = JSON.stringify({ error: 123 })
    const error = new api.ApiError(400, body)
    expect(error.message).toBe(body)
  })

  it('message フィールドが文字列でなければボディ全体を使う', () => {
    const body = JSON.stringify({ message: 123 })
    const error = new api.ApiError(400, body)
    expect(error.message).toBe(body)
  })
})

describe('通信できないときの扱い', () => {
  /** 応答も本文も返さず、打ち切り（abort）されたときだけ失敗する接続 */
  function stalledFetch() {
    return vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          })
        }),
    )
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('応答が返らないまま既定の時間を過ぎたら NetworkError で打ち切る', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', stalledFetch())

    const request = api.apiFetch('/api/test', z.object({}))
    const caught = request.catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(api.DEFAULT_TIMEOUT_MS)

    const error = await caught
    expect(error).toBeInstanceOf(api.NetworkError)
    expect((error as InstanceType<typeof api.NetworkError>).kind).toBe('timeout')
  })

  it('打ち切りより前に応答が返れば成功する（待てる範囲で待つ）', async () => {
    vi.useFakeTimers()
    const fetchLate = vi.fn(
      () =>
        new Promise<Response>(resolve => {
          setTimeout(() => resolve(jsonResponse(200, { value: 1 })), api.DEFAULT_TIMEOUT_MS - 1)
        }),
    )
    vi.stubGlobal('fetch', fetchLate)

    const request = api.apiFetch('/api/test', z.object({ value: z.number() }))
    await vi.advanceTimersByTimeAsync(api.DEFAULT_TIMEOUT_MS - 1)

    await expect(request).resolves.toEqual({ value: 1 })
  })

  it('アップロードは既定の時間を過ぎても打ち切らない（PDF の変換を待つため）', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', stalledFetch())

    const request = api.apiMutate(
      '/api/imports/pdf',
      { method: 'POST', body: new FormData(), timeoutMs: api.UPLOAD_TIMEOUT_MS },
      z.object({}),
    )
    let settled = false
    void request.catch(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(api.DEFAULT_TIMEOUT_MS)

    expect(settled).toBe(false)

    const assertion = expect(request).rejects.toThrowError(api.NetworkError)
    await vi.advanceTimersByTimeAsync(api.UPLOAD_TIMEOUT_MS)
    await assertion
  })

  it('ヘッダだけ返って本文が来ない接続も打ち切る（読み取りまで制限時間に含める）', async () => {
    vi.useFakeTimers()
    // 応答は返るが、本文の読み取りが終わらない（途中で切れた接続）
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            new Promise((_resolve, reject) => {
              init.signal?.addEventListener('abort', () => {
                reject(new DOMException('The operation was aborted.', 'AbortError'))
              })
            }),
          text: () =>
            new Promise((_resolve, reject) => {
              init.signal?.addEventListener('abort', () => {
                reject(new DOMException('The operation was aborted.', 'AbortError'))
              })
            }),
        } as unknown as Response),
      ),
    )

    const request = api.apiFetch('/api/test', z.object({}))
    const caught = request.catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(api.DEFAULT_TIMEOUT_MS)

    expect(await caught).toBeInstanceOf(api.NetworkError)
  })

  it('送信でもヘッダだけ返って本文が来ない接続を打ち切る', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () =>
            new Promise((_resolve, reject) => {
              init.signal?.addEventListener('abort', () => {
                reject(new DOMException('The operation was aborted.', 'AbortError'))
              })
            }),
        } as unknown as Response),
      ),
    )

    const request = api.apiMutate('/api/test', { method: 'POST' }, z.object({}))
    const caught = request.catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(api.DEFAULT_TIMEOUT_MS)

    expect(await caught).toBeInstanceOf(api.NetworkError)
  })

  it('サーバーに届かない（fetch が TypeError）なら NetworkError にする', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    const error = await api.apiFetch('/api/test', z.object({})).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(api.NetworkError)
    // 打ち切りと取り違えると、原因調査で「遅い」方を疑うことになる
    expect((error as InstanceType<typeof api.NetworkError>).kind).toBe('unreachable')
  })

  it('送信でもサーバーに届かなければ NetworkError にする', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(
      api.apiMutate('/api/test', { method: 'POST', body: {} }, z.object({})),
    ).rejects.toThrowError(api.NetworkError)
  })

  it('NetworkError の文言は全画面で共通のものを使う', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(api.apiFetch('/api/test', z.object({}))).rejects.toThrowError(
      api.NETWORK_ERROR_MESSAGE,
    )
  })

  it('サーバーが返したエラーは NetworkError に変えない', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: 'server down' }))

    const error = await api.apiFetch('/api/test', z.object({})).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(api.ApiError)
    expect((error as InstanceType<typeof api.ApiError>).status).toBe(500)
    expect((error as Error).message).toBe('server down')
  })
})

describe('describeRequestFailure', () => {
  it('通信の失敗なら画面ごとの文言ではなく共通の文言を返す', () => {
    const message = api.describeRequestFailure(
      new api.NetworkError('unreachable'),
      '取引一覧の取得に失敗しました',
    )

    expect(message).toBe(api.NETWORK_ERROR_MESSAGE)
  })

  it('サーバーが返したエラーなら画面ごとの文言を返す', () => {
    const message = api.describeRequestFailure(
      new api.ApiError(500, 'boom'),
      '取引一覧の取得に失敗しました',
    )

    expect(message).toBe('取引一覧の取得に失敗しました')
  })

  it('エラーが無い（null）場合も画面ごとの文言を返す', () => {
    expect(api.describeRequestFailure(null, '取引一覧の取得に失敗しました')).toBe(
      '取引一覧の取得に失敗しました',
    )
  })
})

describe('通信の失敗と取り違えないもの', () => {
  it('スキーマ検証の失敗は NetworkError にしない（応答の不整合を通信のせいにしない）', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { value: 'string' }))

    await expect(api.apiFetch('/api/test', z.object({ value: z.number() }))).rejects.toThrowError(
      z.ZodError,
    )
  })

  it('送信でもスキーマ検証の失敗は NetworkError にしない', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { value: 'string' }))

    await expect(
      api.apiMutate('/api/test', { method: 'POST' }, z.object({ value: z.number() })),
    ).rejects.toThrowError(z.ZodError)
  })
})
