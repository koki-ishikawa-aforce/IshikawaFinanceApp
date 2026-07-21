'use client'

import { useQuery } from '@tanstack/react-query'
import type { DashboardKpisView, DashboardMode, YearMonth } from '@warimaru/domain'
import { DashboardKpisViewSchema } from '@warimaru/domain'
import { apiFetch } from '@/lib/api-client'

export function useDashboardKpis(month: YearMonth, mode: DashboardMode) {
  return useQuery<DashboardKpisView>({
    queryKey: ['dashboard', 'kpis', month, mode],
    queryFn: () =>
      apiFetch(
        `/api/dashboard/kpis?month=${month}&mode=${mode}`,
        DashboardKpisViewSchema,
      ),
    staleTime: 30_000,
  })
}
