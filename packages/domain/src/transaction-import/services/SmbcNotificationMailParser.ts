/**
 * SMBC 通知メール本文のパース関数（08a §2「SMBC通知メール本文をパースする」）
 *
 * behavior SMBC通知メール本文をパースする = SMBC通知メール本文 -> SMBC通知パース結果 OR パース失敗
 *
 * 他の `services/` の型（`GmailMailFetchGateway` / `PdfToCsvConverter`）は外部システムへの
 * driven port だが、これは**純粋なドメイン処理の関数型**である。日次メール取込ワーカー（#414）が
 * 「取得 → パース → 候補生成」を組み立てる時点で、実パースルール（#415、実メールのフォーマット
 * 確定待ち）がまだ無いため、呼出し側が依存するのは本シグネチャだけにして、実装を差し替えられる
 * 形にしてある。#415 の実装もドメイン内（zod のみ・I/O 依存なし）に置く。
 *
 * 時刻とユーザーは引数で受け取る。パース結果は「誰の取引か」（`userId`）と、失敗したときの
 * 「いつ気づいたか」（`detectedAt`）を持つが、どちらも本文からは決まらないためである
 * （実装が `new Date()` を呼ぶとテストで時刻を固定できず、ドメインに I/O が混じる）。
 */
import type { UserId } from '../../shared/ids'
import type { SmbcMailParseResult } from '../value-objects/SmbcMailParseResult'
import type { SmbcNotificationMailBody } from './GmailMailFetchGateway'

export interface SmbcNotificationMailParseInput {
  /** Gmail から取得した外部表現（パース前。本文は文字列のまま） */
  mail: SmbcNotificationMailBody
  /** 取り込む対象のユーザー（受信箱の持ち主） */
  userId: UserId
  /** パース失敗の検知日時（`parse_failure` の `detectedAt` に載る） */
  at: Date
}

/**
 * 本文とメール種別ヒントから 1 通ぶんのパース結果を返す。例外は投げず、失敗も
 * `SmbcMailParseResult` の `parse_failure` として返す（1 通の失敗で取込全体を止めないため）。
 */
export type SmbcNotificationMailParser = (
  input: SmbcNotificationMailParseInput,
) => SmbcMailParseResult
