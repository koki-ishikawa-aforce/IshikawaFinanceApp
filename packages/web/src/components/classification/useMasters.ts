'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-client'
import { CategoryListWireSchema, ExpenseTypeListWireSchema } from '@/lib/api-schemas'

/**
 * 分類の 3 軸で選ぶマスタ（カテゴリ / 経費種別）を取得する。
 * 取引の編集モーダルと一括分類セッションの双方から使う。
 */
export function useMasters() {
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
  return { categories: categories.data?.items ?? [], expenseTypes: expenseTypes.data?.items ?? [] }
}
