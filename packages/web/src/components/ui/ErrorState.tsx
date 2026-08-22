import type { ReactNode } from 'react'
import styles from './ErrorState.module.css'

interface ErrorStateProps {
  /** 何が失敗したかを伝える文言。再試行の手段は器の側(呼び出し側)に置く */
  children: ReactNode
  /**
   * 支援技術へ通知するか。既定 true。
   *
   * 開いた時点から内容が変わらない場所(モーダルを開いた時点で確定しているエラーなど)では
   * false にする。そこに live region を置くと、モーダル自体の読み上げに重ねて二重に読まれるため
   */
  announce?: boolean
}

/**
 * 取得・保存に失敗したことを伝える共通のエラー表示。
 *
 * - 見た目はインラインのテキストに統一する(ローディング `LoadingState`・空状態 `EmptyState` と
 *   同じ器の中で入れ替わるため)
 * - 失敗はその場で気づけないと操作をやり直せないため、既定で `role="alert"` を付ける
 *   (`docs/design/usability.md` 8-4 の「致命的なものは `role="alert"`」)。
 *   `role="status"` と違い、挿入された時点で割り込んで読み上げられる
 *
 * 再試行手段(1-3)は失敗の種類ごとに置き場所が変わるため、この部品には含めない
 */
export function ErrorState({ children, announce = true }: ErrorStateProps) {
  return (
    <div className={styles.error} role={announce ? 'alert' : undefined}>
      {children}
    </div>
  )
}
