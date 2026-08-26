'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-client'
import { SpouseProfileWireSchema } from '@/lib/api-schemas'

/**
 * 相手（配偶者）のプロフィール（役割・ニックネーム）。残高画面・ダッシュボードが
 * 相手の呼び名（ニックネーム、未設定ならロール名フォールバック）を出すために使う(#596)。
 */
export function useSpouseProfile() {
  return useQuery({
    queryKey: ['spouse-profile'],
    queryFn: () => apiFetch('/api/settings/spouse-profile', SpouseProfileWireSchema),
  })
}
