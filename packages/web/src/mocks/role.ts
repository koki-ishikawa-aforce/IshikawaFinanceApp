/**
 * モック起動モード（NEXT_PUBLIC_MOCK=1）での閲覧ロール解決。
 *
 * ロールはテーマ（darling / honey）に直結するため、URL クエリ `?mockRole=honey`
 * で切り替えられるようにする。指定が無ければ darling を既定とする。
 * ロールの値はドメインの {@link UserRole} を参照し、独自の同義リテラルは作らない。
 *
 * 画面遷移（`next/link`）はクエリを引き継がないため、クエリで指定されたロールは
 * タブ単位（sessionStorage）で保持する。これが無いと、honey で開いたあと 1 度でも
 * 遷移・リロードすると無言で darling のデータに戻り、テーマとデータが食い違う。
 */
import type { UserRole } from '@warimaru/domain'

export type MockRole = UserRole

const STORAGE_KEY = 'warimaru.mockRole'

function isMockRole(value: string | null): value is MockRole {
  return value === 'darling' || value === 'honey'
}

export function getMockRole(): MockRole {
  if (typeof window === 'undefined') return 'darling'

  // クエリでの明示指定を常に優先する（保持済みのロールを上書きできる）。
  const fromQuery = new URLSearchParams(window.location.search).get('mockRole')
  if (isMockRole(fromQuery)) {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, fromQuery)
    } catch {
      // sessionStorage が使えない環境では保持を諦める（既定へ戻るだけで画面は動く）
    }
    return fromQuery
  }

  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY)
    if (isMockRole(stored)) return stored
  } catch {
    // 同上
  }
  return 'darling'
}
