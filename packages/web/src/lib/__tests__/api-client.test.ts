import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ApiError, apiFetch, apiMutate } from '../api-client'
import { getIdToken, isLiffEnabled } from '@/lib/liff'

vi.mock('@/lib/liff', () => ({
  isLiffEnabled: vi.fn(() => false),
  getIdToken: vi.fn((): string | null => null),
}))

const fetchMock = vi.fn()

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('apiFetch', () => {
  it('スキーマで parse した結果を返す', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { value: 42 }))

    const result = await apiFetch('/api/test', z.object({ value: z.number() }))

    expect(result).toEqual({ value: 42 })
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:3001/api/test')
  })

  it('LIFF 無効時は X-User-Id ヘッダを送る', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}))

    await apiFetch('/api/test', z.object({}))

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.headers).toEqual({ 'X-User-Id': 'U_DARLING_DEV' })
  })

  it('LIFF 有効かつトークンありなら Authorization ヘッダを送る', async () => {
    vi.mocked(isLiffEnabled).mockReturnValue(true)
    vi.mocked(getIdToken).mockReturnValue('token-123')
    fetchMock.mockResolvedValue(jsonResponse(200, {}))

    await apiFetch('/api/test', z.object({}))

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.headers).toEqual({ Authorization: 'Bearer token-123' })
  })

  it('LIFF 有効でもトークンがなければ X-User-Id にフォールバックする', async () => {
    vi.mocked(isLiffEnabled).mockReturnValue(true)
    vi.mocked(getIdToken).mockReturnValue(null)
    fetchMock.mockResolvedValue(jsonResponse(200, {}))

    await apiFetch('/api/test', z.object({}))

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.headers).toEqual({ 'X-User-Id': 'U_DARLING_DEV' })
  })

  it('非 2xx なら ApiError を投げる', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { message: 'not found' }))

    await expect(apiFetch('/api/test', z.object({}))).rejects.toThrowError(ApiError)
  })

  it('スキーマ不一致なら ZodError を投げる', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { value: 'string' }))

    await expect(apiFetch('/api/test', z.object({ value: z.number() }))).rejects.toThrowError(
      z.ZodError,
    )
  })
})

describe('apiMutate', () => {
  it('JSON ボディを Content-Type 付きで送る', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }))

    const result = await apiMutate(
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

    await apiMutate('/api/test', { method: 'POST', body: formData }, z.object({}))

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.body).toBe(formData)
    expect(init.headers).not.toMatchObject({ 'Content-Type': expect.anything() })
  })

  it('body なしの DELETE を送れる', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}))

    await apiMutate('/api/test/1', { method: 'DELETE' }, z.object({}))

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('DELETE')
    expect(init.body).toBeUndefined()
  })

  it('空レスポンスは null として parse する', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 200 }))

    const result = await apiMutate('/api/test', { method: 'DELETE' }, z.null())

    expect(result).toBeNull()
  })

  it('非 2xx なら ApiError を投げる', async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { message: 'conflict' }))

    await expect(apiMutate('/api/test', { method: 'PUT', body: {} }, z.object({}))).rejects.toThrow(
      'conflict',
    )
  })
})

describe('ApiError', () => {
  it('JSON ボディの message をエラーメッセージに使う', () => {
    const error = new ApiError(400, JSON.stringify({ message: '入力が不正です' }))
    expect(error.message).toBe('入力が不正です')
    expect(error.status).toBe(400)
  })

  it('JSON でないボディはそのままメッセージに使う', () => {
    const error = new ApiError(500, 'Internal Server Error')
    expect(error.message).toBe('Internal Server Error')
  })

  it('空ボディならステータス入りの既定メッセージを使う', () => {
    const error = new ApiError(502, '')
    expect(error.message).toBe('API error 502')
  })

  it('message フィールドが文字列でなければボディ全体を使う', () => {
    const body = JSON.stringify({ message: 123 })
    const error = new ApiError(400, body)
    expect(error.message).toBe(body)
  })
})
