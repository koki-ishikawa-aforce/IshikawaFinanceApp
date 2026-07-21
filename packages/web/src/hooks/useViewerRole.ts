'use client'

import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { apiFetch } from '@/lib/api-client'

const MeResponseSchema = z.object({
  viewerId: z.string(),
  role: z.enum(['honey', 'darling']),
})

export function useViewerRole() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => apiFetch('/api/me', MeResponseSchema),
    staleTime: Infinity,
  })
}
