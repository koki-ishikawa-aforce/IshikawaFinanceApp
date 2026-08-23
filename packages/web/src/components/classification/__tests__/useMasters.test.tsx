/**
 * 分類マスタ（カテゴリ / 経費種別）の取得結果のまとめ方を固定する。
 *
 * `error` は「通信の失敗なら全画面共通の文言を出す」ために呼び出し側へ渡すものなので
 * (`docs/design/usability.md` §7-7)、どちらが失敗しても取り出せることを押さえる。
 * ここが常に null に戻ると、分類画面だけ圏外の理由が伝わらなくなる。
 */
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { useMasters } from '../useMasters'
import { NetworkError } from '@/lib/api-client'

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

/** path ごとに応答を切り替える fetch。片方だけ失敗する状況を作るために使う */
function stubFetchByPath(failing: 'categories' | 'expense-types' | 'both'): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const isCategories = url.includes('/api/categories')
      const shouldFail =
        failing === 'both' ||
        (failing === 'categories' && isCategories) ||
        (failing === 'expense-types' && !isCategories)
      if (shouldFail) return Promise.reject(new TypeError('Failed to fetch'))
      return Promise.resolve(
        new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useMasters', () => {
  it('カテゴリ側が通信で失敗したら、その失敗を取り出せる', async () => {
    stubFetchByPath('categories')

    const { result } = renderHook(() => useMasters(), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(NetworkError)
  })

  it('経費種別側が通信で失敗したら、その失敗を取り出せる', async () => {
    stubFetchByPath('expense-types')

    const { result } = renderHook(() => useMasters(), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(NetworkError)
  })

  it('どちらも成功していれば失敗は無い', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ items: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    )

    const { result } = renderHook(() => useMasters(), { wrapper })

    await waitFor(() => expect(result.current.isPending).toBe(false))
    expect(result.current.isError).toBe(false)
    expect(result.current.error).toBeNull()
  })
})
