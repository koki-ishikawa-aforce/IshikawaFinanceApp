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
   * false にしてよいのは、その場所が**別の経路で確実に読み上げられる**ときだけ。
   * 現状の `Modal` は開いてもフォーカスをモーダル内へ移さないため(同 §9 #10)、
   * ダイアログとしての読み上げは起きない。ここで false にすると、伏せている旨が
   * 読み上げ利用者に一度も伝わらなくなる
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
 *
 * **本番の取引一覧には、伏せ字の行そのものが載らない。** プライバシーの判定点である
 * `applyPrivacyFilter`(domain)は相手の個人取引を**行ごと除外**するため、
 * `GET /api/transactions` から明細が null の行は返らない。この表示が実際に出るのは
 * モック起動モード(`src/mocks/fixtures.ts`)と、万一そうした行が届いたときの保険の経路。
 * 「相手の個人取引は伏せ字行として一覧に残る」という契約ではないことに注意する
 */
export function RestrictedState({ children, announce = true }: RestrictedStateProps) {
  // 文言が空なら何も出さない(`ErrorState` と同じガード)。錠前のアイコンと面だけが残ると、
  // 何が見えないのか伝わらないまま「見えないものがある」ことだけを示すことになる
  if (children === null || children === undefined || children === '') return null

  return (
    <div className={styles.restricted} role={announce ? 'status' : undefined}>
      {/* 文言が意味を伝えるため装飾扱い(`DESIGN.md` §6) */}
      <LuLock className={`${ui.iconSm} ${styles.icon}`} aria-hidden="true" />
      <span className={styles.message}>{children}</span>
    </div>
  )
}
