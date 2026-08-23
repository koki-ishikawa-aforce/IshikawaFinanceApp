'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-client'
import { CategoryListWireSchema, ExpenseTypeListWireSchema } from '@/lib/api-schemas'

export interface MastersState {
  categories: { categoryId: string; name: string }[]
  expenseTypes: { expenseTypeId: string; name: string }[]
  /** どちらかが取得中。選択肢が確定するまで空のセレクトを見せないために使う */
  isPending: boolean
  /** どちらかが失敗。分類の 3 軸が選べないため、呼び出し側で再試行手段を出す */
  isError: boolean
  /** 失敗したときの最初のエラー。通信の失敗を共通の文言で伝えるために呼び出し側へ渡す */
  error: Error | null
  refetch: () => void
}

/**
 * 分類の 3 軸で選ぶマスタ（カテゴリ / 経費種別）を取得する。
 * 取引の編集モーダルと一括分類セッションの双方から使う。
 */
export function useMasters(): MastersState {
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch('/api/categories', CategoryListWireSchema),
    staleTime: 60_000,
  })
  const expenseTypes = useQuery({
    queryKey: ['expense-types'],
    queryFn: () => apiFetch('/api/expense-types', ExpenseTypeListWireSchema),
    staleTime: 60_000,
  })
  return {
    categories: categories.data?.items ?? [],
    expenseTypes: expenseTypes.data?.items ?? [],
    isPending: categories.isPending || expenseTypes.isPending,
    isError: categories.isError || expenseTypes.isError,
    error: categories.error ?? expenseTypes.error,
    refetch: () => {
      void categories.refetch()
      void expenseTypes.refetch()
    },
  }
}
