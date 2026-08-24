import type { ReactNode } from 'react'
import { LuLock } from './icons'
import ui from './common.module.css'
import styles from './RestrictedState.module.css'

interface RestrictedStateProps {
  /** 何が・なぜ見えないのかを伝える文言(`docs/design/usability.md` 2-2) */
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
 * プライバシー3段階ルールにより明細を見せていないことを伝える共通表示。
 *
 * - 空状態(`EmptyState`)と**見た目を分ける**。どちらも同じインラインのテキストで出すと
 *   「データが無い」と受け取られ、相手の取引が消えたと誤解される(同 2-2)。
 *   錠前のアイコンとアクセント色の面で、意図して伏せていることを見た目でも伝える
 * - 経費(会社)には使わない。相手の画面には存在自体を出さないのが正しく、
 *   「見えないものがある」と示唆する表示を出すこと自体が違反になる(同 2-3)
 * - 表示するかどうかは API が返す値(null 等)で決める。UI 側でプライバシー段階を
 *   再判定しない(同 2-5)
 * - 見せない対象が切り替わる場所では既定で `role="status"` を付ける(同 8-4)。
 *   同じ器の中で入れ替わる空状態・ローディング・エラーと揃えている
 */
export function RestrictedState({ children, announce = true }: RestrictedStateProps) {
  // 文言が空なら何も出さない。錠前のアイコンと面だけが残ると、何が見えないのか
  // 伝わらないまま「見えないものがある」ことだけを示すことになる
  if (children === null || children === undefined || children === '') return null

  return (
    <div className={styles.restricted} role={announce ? 'status' : undefined}>
      {/* 文言が意味を伝えるため装飾扱い(`DESIGN.md` §6) */}
      <LuLock className={ui.iconSm} aria-hidden="true" />
      <span className={styles.message}>{children}</span>
    </div>
  )
}
