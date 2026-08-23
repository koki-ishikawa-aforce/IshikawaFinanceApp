import type { ReactNode } from 'react'
import ui from './common.module.css'
import styles from './ErrorState.module.css'

interface ErrorStateProps {
  /** 何が失敗したかを伝える文言 */
  children: ReactNode
  /**
   * 支援技術へ通知するか。既定 true。
   *
   * 開いた時点から内容が変わらない場所(モーダルを開いた時点で確定しているエラーなど)では
   * false にする。そこに live region を置くと、モーダル自体の読み上げに重ねて二重に読まれるため
   */
  announce?: boolean
  /**
   * 再読み込みの手段(`docs/design/usability.md` 1-3)。渡すと文言の下に「再読み込み」を出す。
   *
   * 取り直す対象が無い場所では渡さない。保存・削除の失敗はやり直しの手段が元のボタン
   * (「保存」「削除を実行」)の側にあり、ここに二つ目の手段を出すとどちらを押すか迷わせる
   */
  onRetry?: () => void
  /**
   * 再読み込みが進行中か(`query.isFetching` を渡す)。
   *
   * 取得に失敗している間は文言もエラーの見た目も変わらないため、これが無いと押しても
   * 表示が 1 ドットも動かず「壊れている」ように見える(同 3-7 / 6-2)。通信の打ち切りは
   * 15 秒・再試行 1 回なので、無反応の時間は最長 30 秒近くになる
   */
  isRetrying?: boolean
}

/** 再読み込みの文言。画面ごとに言い換えると同じ操作に見えなくなるため 1 か所に固定する */
const RETRY_LABEL = '再読み込み'
/** 進行中の文言も動作に対応させる(同 5-7) */
const RETRYING_LABEL = '再読み込み中...'

/**
 * 取得・保存に失敗したことを伝える共通のエラー表示。
 *
 * - 見た目はインラインのテキストに統一する(ローディング `LoadingState`・空状態 `EmptyState` と
 *   同じ器の中で入れ替わるため)
 * - 失敗はその場で気づけないと操作をやり直せないため、既定で `role="alert"` を付ける
 *   (`docs/design/usability.md` 8-4 の「致命的なものは `role="alert"`」)。
 *   `role="status"` と違い、挿入された時点で割り込んで読み上げられる
 * - 取得の失敗は文言だけで終わらせず、`onRetry` で再読み込みの手段を添える(同 1-3)。
 *   手段を部品の外に置くと画面ごとに文言も位置もばらつくため、この部品に集約する(#366)。
 *   ボタンは live region の**外**に置く。中に入れると、読み上げが失敗の文言に続けて
 *   ボタンのラベルまで一息に読むことになり、何が起きたのかが埋もれる
 */
export function ErrorState({
  children,
  announce = true,
  onRetry,
  isRetrying = false,
}: ErrorStateProps) {
  // 文言が空(API のエラーメッセージが空文字だったなど)なら何も出さない。
  // 無音の live region と赤い余白だけが残るのを避ける
  if (children === null || children === undefined || children === '') return null

  return (
    <>
      <div className={styles.error} role={announce ? 'alert' : undefined}>
        {children}
      </div>
      {onRetry && (
        <div className={styles.retryRow}>
          <button type="button" className={ui.buttonGhost} onClick={onRetry} disabled={isRetrying}>
            {isRetrying ? RETRYING_LABEL : RETRY_LABEL}
          </button>
        </div>
      )}
    </>
  )
}
