/** VRT・タイポグラフィ検証で共通に使う画面一覧。画面を追加したら 1 か所だけ直す。 */
export const SCREENS = [
  { name: 'dashboard', path: '/' },
  { name: 'transactions', path: '/transactions' },
  { name: 'balances', path: '/balances' },
  { name: 'reports', path: '/reports' },
  { name: 'settings', path: '/settings' },
  // 設定のタブは初期表示が ?section= で決まる。既定タブ（プロフィール）の撮影では
  // 学習ルールの見た目を押さえられないため、別画面として並べる
  { name: 'settings-classification', path: '/settings?section=classification' },
  { name: 'onboarding', path: '/onboarding' },
] as const

export type Screen = (typeof SCREENS)[number]

/** ロール（＝テーマ）をモック起動モードに伝えるクエリ文字列。既定は darling */
export function mockRoleQuery(theme: 'darling' | 'honey'): string {
  return theme === 'honey' ? '?mockRole=honey' : ''
}

/**
 * 画面のパスにテーマ指定を足した URL を返す。
 * パスが既にクエリを持つ場合（設定のタブ指定など）は `&` で連結する
 * （`?` を二重に付けると section が読めずタブが既定へ落ちる）。
 */
export function screenUrl(path: string, theme: 'darling' | 'honey'): string {
  if (theme === 'darling') return path
  return path.includes('?') ? `${path}&mockRole=honey` : `${path}?mockRole=honey`
}
