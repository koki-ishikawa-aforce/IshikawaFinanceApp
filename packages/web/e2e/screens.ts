/** VRT・タイポグラフィ検証で共通に使う画面一覧。画面を追加したら 1 か所だけ直す。 */
export const SCREENS = [
  { name: 'dashboard', path: '/' },
  { name: 'transactions', path: '/transactions' },
  { name: 'balances', path: '/balances' },
  { name: 'reports', path: '/reports' },
  { name: 'imports', path: '/imports' },
  { name: 'expense-settlement', path: '/expense-settlement' },
  { name: 'settings', path: '/settings' },
  // 設定のタブは初期表示が ?section= で決まる。既定タブ（プロフィール）の撮影では
  // 学習ルールの見た目を押さえられないため、別画面として並べる
  { name: 'settings-classification', path: '/settings?section=classification' },
  // 口座タブの追加ボタンは、その口座種別が未登録の人にだけ出る。既定の fixture は
  // 登録済みの世帯なので、未登録のシナリオを指定して撮る（#425）
  {
    name: 'settings-accounts-unregistered',
    path: '/settings?section=accounts&mockScenario=accounts-unregistered',
  },
  // 口座を 1 件も持たない状態（#395 以降の新規利用者の出発点）。4 種すべての追加ボタンが
  // 並ぶのはこのときだけで、縦画面での折り返しもここでしか見張れない
  {
    name: 'settings-accounts-none',
    path: '/settings?section=accounts&mockScenario=accounts-none',
  },
  // 同じシナリオは残高画面の見え方も変える（貯蓄・NISA の行が消え、鮮度の知らせが
  // 空になり、推移グラフの系列が減る）。撮っておかないとその状態だけ見張られない
  { name: 'balances-accounts-unregistered', path: '/balances?mockScenario=accounts-unregistered' },
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
