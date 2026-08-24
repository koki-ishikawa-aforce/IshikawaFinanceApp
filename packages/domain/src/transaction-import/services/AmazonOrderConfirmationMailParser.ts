/**
 * Amazon 注文確認メール本文のパース関数（08a §2「Amazon注文確認メール本文をパースする」）
 *
 * behavior Amazon注文確認メール本文をパースする = Amazon注文確認メール本文
 *   -> Amazon注文情報 OR パース失敗
 *
 * `SmbcNotificationMailParser` と同じ扱いで、外部システムへの driven port ではなく**純粋な
 * ドメイン処理の関数型**である。日次メール取込ワーカーが依存するのは本シグネチャだけなので、
 * テストではスタブを、本文構造が変わったときは別実装を差し替えられる。
 *
 * 持ち主（`userId`）と検知日時（`at`）は本文から決まらないため引数で受け取る。実装が
 * `new Date()` を呼ぶとテストで時刻を固定できず、ドメインに I/O が混じる。
 */
import type { UserId } from '../../shared/ids'
import type { AmazonMailParseResult } from '../value-objects/AmazonMailParseResult'
import type { AmazonOrderConfirmationMailBody } from './GmailMailFetchGateway'

export interface AmazonOrderConfirmationMailParseInput {
  /** Gmail から取得した外部表現（パース前。本文は文字列のまま） */
  mail: AmazonOrderConfirmationMailBody
  /** 取り込む対象のユーザー（受信箱の持ち主） */
  userId: UserId
  /** パース失敗の検知日時（`parse_failure` の `detectedAt` に載る） */
  at: Date
}

/**
 * 本文から 1 通ぶんのパース結果を返す。例外は投げず、失敗も `parse_failure` として返す
 * （1 通の失敗で取込全体を止めないため）。
 */
export type AmazonOrderConfirmationMailParser = (
  input: AmazonOrderConfirmationMailParseInput,
) => AmazonMailParseResult
