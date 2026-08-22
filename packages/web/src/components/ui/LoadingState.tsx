import type { ReactNode } from 'react'
import styles from './LoadingState.module.css'

interface LoadingStateProps {
  /** 何を読み込んでいるかを示す文言。既定は「読み込み中...」 */
  children?: ReactNode
  /**
   * 支援技術へ通知するか。既定 true。
   *
   * 開いた時点から内容が変わらない場所(初期表示だけの Suspense フォールバックなど)では
   * false にする。マウント時点から動かない領域に live region を置いても通知は起きず、
   * 器そのものの読み上げに重なるだけになるため
   */
  announce?: boolean
}

/**
 * データを取得している最中であることを伝える共通のローディング表示。
 *
 * - 見た目はインラインのテキストに統一する(空状態 `EmptyState` と同じ器の中で入れ替わるため)
 * - 取得の切り替わりで内容が差し替わる領域のため、既定で `role="status"` を付ける
 *   (`docs/design/usability.md` 8-4)。月やモードの切り替えは画面遷移を伴わず、
 *   指定が無いと「読み込み中」に切り替わったことが読み上げられない
 *
 * 挿入と同時に live region が現れる形になるため、読み上げの確実性を上げたい領域では
 * 呼び出し側で常時マウントの `role="status"` の入れ物に入れ、この部品は `announce={false}` で使う
 * (例: `app/balances/page.tsx` の口座残高、`components/balances/BalanceFreshness.tsx`)
 */
export function LoadingState({ children = '読み込み中...', announce = true }: LoadingStateProps) {
  // 文言を空で渡されたら何も出さない(無音の live region と余白だけが残るのを避ける)
  if (children === null || children === '') return null

  return (
    <div className={styles.loading} role={announce ? 'status' : undefined}>
      {children}
    </div>
  )
}
