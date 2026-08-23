/**
 * アプリ全体の通信設定（TanStack Query の既定）。
 *
 * @see docs/design/usability.md §7-7（通信できないときの振る舞い）
 */
import { QueryClient } from '@tanstack/react-query'

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        // 既定の 'online' は navigator.onLine が false の間、要求を送らずに保留する。
        // 保留中は isPending が立ったままエラーにならないため、画面は「読込中」「変換中...」の
        // 表示で止まり、失敗も再試行手段も出ない。LIFF の WebView では onLine の判定自体が
        // 当てにならない（機内モードを検知できない端末、圏内なのに false を返す端末がある）ため、
        // 「送ってみて、駄目なら失敗として見せる」に倒す。実際の失敗は api-client の
        // 打ち切り時間と NetworkError が拾う
        networkMode: 'always',
      },
      mutations: {
        networkMode: 'always',
      },
    },
  })
}
