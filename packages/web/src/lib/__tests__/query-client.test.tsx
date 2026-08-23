/**
 * アプリ全体の通信設定を固定する。
 *
 * 既定の networkMode('online') に戻ると、通信できない間の要求が送られずに保留され、
 * 画面は「読込中」「変換中...」のまま止まる（失敗にならないためエラーも再試行手段も出ない）。
 * 症状が「固まる」だけで気づきにくいため、設定値ではなく振る舞いで押さえる。
 */
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider, onlineManager, useMutation, useQuery } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import { createQueryClient } from '../query-client'

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider>
}

afterEach(() => {
  onlineManager.setOnline(true)
})

describe('createQueryClient', () => {
  it('通信できない間の読み取りは、保留されずに失敗として表に出る', async () => {
    onlineManager.setOnline(false)

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['offline-read'],
          queryFn: () => Promise.reject(new Error('圏外')),
          retry: false,
        }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.isError).toBe(true))
    // 保留（fetchStatus: 'paused'）のまま止まると、この時点でも isPending が立ったままになる
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('通信できない間の送信も、保留されずに失敗として表に出る', async () => {
    onlineManager.setOnline(false)

    const { result } = renderHook(
      () => useMutation({ mutationFn: () => Promise.reject(new Error('圏外')) }),
      { wrapper },
    )
    result.current.mutate()

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.isPending).toBe(false)
  })

  it('読み取りは 1 回だけ再試行し、30 秒は取り直さない', () => {
    const defaults = createQueryClient().getDefaultOptions()

    expect(defaults.queries?.retry).toBe(1)
    expect(defaults.queries?.staleTime).toBe(30_000)
  })
})
