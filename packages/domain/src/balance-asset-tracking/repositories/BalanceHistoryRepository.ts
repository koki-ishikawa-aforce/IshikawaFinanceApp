/**
 * 残高変動履歴の永続化 I/F（#398）
 * @see docs/domain/09-aggregates.md #10c
 *
 * 追記のみ。更新・削除の口を持たせない（過去のグラフが後から変わらないようにする）。
 */
import type { BalanceHistoryEntry } from '../aggregates/BalanceHistoryEntry'
import type { BalanceAxis } from '../value-objects/BalanceAxis'

export interface BalanceHistoryRepository {
  /**
   * 変動を 1 件追記する。
   *
   * 冪等: 同一の (残高軸, 由来イベントID) が既にあれば何もしない。イベント配信は
   * at-least-once のため、同じ変動が二度届いてもグラフに点が重ならないようにする責務を
   * 実装側（DB の一意制約）に置く。呼び出し側は再実行のたびに素直に呼んでよい。
   */
  append(entry: BalanceHistoryEntry): Promise<void>

  /**
   * 発生日時が from 以上 toExclusive 未満のエントリを、軸を問わず発生日時の昇順で返す。
   * 上端を「未満」にするのは月の切り出しが主用途のため（月末の最終ミリ秒を意識せずに
   * 翌月の開始時刻を渡せば、月境界の点が隣の月へ二重に入らない）。
   */
  findByOccurredAtRange(from: Date, toExclusive: Date): Promise<BalanceHistoryEntry[]>

  /**
   * 指定軸で atExclusive より前に記録された最後のエントリ。1 件も無ければ null。
   *
   * 「その時点の値」を知るための読み出し。範囲読み出しでは代用できない —
   * 変動が無かった月は範囲に 1 件も入らないが、値そのものは前月から引き継がれている。
   */
  findLatestBefore(axis: BalanceAxis, atExclusive: Date): Promise<BalanceHistoryEntry | null>
}
