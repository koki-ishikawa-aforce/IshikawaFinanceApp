/**
 * モック起動モード（NEXT_PUBLIC_MOCK=1）での閲覧ロール解決。
 *
 * ロールはテーマ（darling / honey）に直結するため、URL クエリ `?mockRole=honey`
 * で切り替えられるようにする。指定が無ければ darling を既定とする。
 */
export type MockRole = 'honey' | 'darling'

export function getMockRole(): MockRole {
  if (typeof window === 'undefined') return 'darling'
  const role = new URLSearchParams(window.location.search).get('mockRole')
  return role === 'honey' ? 'honey' : 'darling'
}
