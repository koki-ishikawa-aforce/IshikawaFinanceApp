import type { ReactNode } from 'react'
import styles from './EmptyState.module.css'

interface EmptyStateProps {
  /** なぜ空か、または何をすれば埋まるかを示す案内文(`docs/design/usability.md` 1-2) */
  children: ReactNode
  /**
   * 支援技術へ通知するか。既定 true。
   *
   * 開いた時点から内容が変わらない場所(モーダル内の固定メッセージなど)では false にする。
   * そこに live region を置くと、モーダル自体の読み上げに重ねて二重に読まれるため
   */
  announce?: boolean
}

/**
 * 表示するデータが無いことを伝える共通の空状態表示。
 *
 * - 見た目はインラインのテキストに統一する(同 6-6。イラストも空状態専用カードも採用しない)。
 *   置き場所は、その空状態が説明しているセクションの器(`ui.card` かモーダル)の内側に揃える
 * - データ有無の切り替わりで内容が差し替わる領域のため、既定で `role="status"` を付ける(同 8-4)。
 *   月やモードの切り替えは画面遷移を伴わず、指定が無いと切り替わりが読み上げられない
 *
 * 同じ器の中のローディング・エラーはまだ無音のままで、通知するかどうかは #341 から切り出して判断待ち
 */
export function EmptyState({ children, announce = true }: EmptyStateProps) {
  return (
    <div className={styles.empty} role={announce ? 'status' : undefined}>
      {children}
    </div>
  )
}
