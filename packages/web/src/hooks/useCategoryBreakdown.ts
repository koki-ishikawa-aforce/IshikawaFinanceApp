'use client'

import { useQuery } from '@tanstack/react-query'
import type { CategoryBreakdownView, DashboardMode, YearMonth } from '@warimaru/domain'
import { CategoryBreakdownViewSchema } from '@warimaru/domain'
import { apiFetch } from '@/lib/api-client'

export function useCategoryBreakdown(month: YearMonth, mode: DashboardMode) {
  return useQuery<CategoryBreakdownView>({
    queryKey: ['dashboard', 'category-breakdown', month, mode],
    queryFn: () =>
      apiFetch(
        `/api/dashboard/category-breakdown?month=${month}&mode=${mode}`,
        CategoryBreakdownViewSchema,
      ),
    staleTime: 30_000,
  })
}
