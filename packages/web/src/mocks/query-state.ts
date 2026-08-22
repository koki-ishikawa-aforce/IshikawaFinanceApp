/**
 * モック起動モード（NEXT_PUBLIC_MOCK=1）で、URL クエリから読む表示状態の共通解決。
 *
 * ロール（{@link ./role}）とシナリオ（{@link ./scenario}）はどちらも
 * 「クエリで指定し、タブ単位で保持する」という同じ規則で動く。画面遷移（`next/link`）は
 * クエリを引き継がないため、保持が無いと 1 度でも遷移・リロードした時点で無言で既定へ戻り、
 * 表示中のテーマやデータが指定と食い違う。規則を 1 か所に置いて、片方だけが直る事態を防ぐ。
 */

interface MockQueryStateSpec<T extends string> {
  /** URL クエリのキー（例: `mockRole`） */
  param: string
  /** sessionStorage のキー（タブ単位の保持に使う） */
  storageKey: string
  /** 受け付ける値かどうか。未知の値は既定へ落とす */
  isValid: (value: string | null) => value is T
  /** 指定が無い・未知の値だったときの既定 */
  fallback: T
}

export function resolveMockQueryState<T extends string>(spec: MockQueryStateSpec<T>): T {
  if (typeof window === 'undefined') return spec.fallback

  // クエリでの明示指定を常に優先する（保持済みの値を上書きできる）。
  const fromQuery = new URLSearchParams(window.location.search).get(spec.param)
  if (spec.isValid(fromQuery)) {
    try {
      window.sessionStorage.setItem(spec.storageKey, fromQuery)
    } catch {
      // sessionStorage が使えない環境では保持を諦める（既定へ戻るだけで画面は動く）
    }
    return fromQuery
  }

  try {
    const stored = window.sessionStorage.getItem(spec.storageKey)
    if (spec.isValid(stored)) return stored
  } catch {
    // 同上
  }
  return spec.fallback
}
