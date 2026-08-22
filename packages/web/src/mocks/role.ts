/**
 * モック起動モード（NEXT_PUBLIC_MOCK=1）での閲覧ロール解決。
 *
 * ロールはテーマ（darling / honey）に直結するため、URL クエリ `?mockRole=honey`
 * で切り替えられるようにする。指定が無ければ darling を既定とする。
 * ロールの値はドメインの {@link UserRole} を参照し、独自の同義リテラルは作らない。
 *
 * クエリで指定されたロールをタブ単位で保持する理由は
 * {@link ./query-state} に記す（シナリオ指定と同じ規則で動く）。
 */
import type { UserRole } from '@warimaru/domain'
import { resolveMockQueryState } from './query-state'

export type MockRole = UserRole

const STORAGE_KEY = 'warimaru.mockRole'

function isMockRole(value: string | null): value is MockRole {
  return value === 'darling' || value === 'honey'
}

export function getMockRole(): MockRole {
  return resolveMockQueryState({
    param: 'mockRole',
    storageKey: STORAGE_KEY,
    isValid: isMockRole,
    fallback: 'darling',
  })
}
