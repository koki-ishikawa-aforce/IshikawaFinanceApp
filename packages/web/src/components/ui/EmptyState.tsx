import type { ReactNode } from 'react'
import styles from './EmptyState.module.css'

interface EmptyStateProps {
  /** なぜ空か、または何をすれば埋まるかを示す案内文(`docs/design/usability.md` 1-2) */
  children: ReactNode
}

/**
 * 表示するデータが無いことを伝える共通の空状態表示。
 *
 * - 見た目はインラインのテキストに統一する(同 6-6。イラストも空状態専用カードも採用しない)。
 *   置き場所は、その空状態が説明しているセクションの器(`ui.card` かモーダル)の内側に揃える
 * - データ有無の切り替わりで内容が差し替わる領域のため、`role="status"` で支援技術へ通知する(同 8-4)。
 *   月やモードの切り替えは画面遷移を伴わず、指定が無いと切り替わりが読み上げられない
 */
export function EmptyState({ children }: EmptyStateProps) {
  return (
    <div className={styles.empty} role="status">
      {children}
    </div>
  )
}
