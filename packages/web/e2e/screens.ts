/** VRT・タイポグラフィ検証で共通に使う画面一覧。画面を追加したら 1 か所だけ直す。 */
export const SCREENS = [
  { name: 'dashboard', path: '/' },
  { name: 'transactions', path: '/transactions' },
  { name: 'balances', path: '/balances' },
  { name: 'reports', path: '/reports' },
  { name: 'imports', path: '/imports' },
  { name: 'settings', path: '/settings' },
  { name: 'onboarding', path: '/onboarding' },
] as const

export type Screen = (typeof SCREENS)[number]

/** ロール（＝テーマ）をモック起動モードに伝えるクエリ文字列。既定は darling */
export function mockRoleQuery(theme: 'darling' | 'honey'): string {
  return theme === 'honey' ? '?mockRole=honey' : ''
}
