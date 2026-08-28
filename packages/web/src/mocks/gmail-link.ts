/**
 * モック起動モード（NEXT_PUBLIC_MOCK=1）での Gmail 連携状態の解決（#392）。
 *
 * 既定は連携中。URL クエリ `?mockGmailLink=revoked` で失効状態を再現できる
 * （失効通知の DM から開いた設定画面のプレビュー用）。口座シナリオ（{@link ./scenario}）
 * とは独立した状態なので `mockScenario` には混ぜない。
 * ロール・シナリオと同じく、指定はタブ単位で保持する（理由は {@link ./query-state}）。
 */
import { resolveMockQueryState } from './query-state'

export type MockGmailLink = 'valid' | 'revoked'

const STORAGE_KEY = 'warimaru.mockGmailLink'

function isMockGmailLink(value: string | null): value is MockGmailLink {
  return value === 'valid' || value === 'revoked'
}

export function getMockGmailLink(): MockGmailLink {
  return resolveMockQueryState({
    param: 'mockGmailLink',
    storageKey: STORAGE_KEY,
    isValid: isMockGmailLink,
    fallback: 'valid',
  })
}
