/**
 * SMBC 通知メール本文のパース関数（08a §2「SMBC通知メール本文をパースする」）
 *
 * behavior SMBC通知メール本文をパースする = SMBC通知メール本文 AND ユーザーID AND 検知日時
 *   -> SMBC通知パース結果 OR パース失敗
 *
 * `GmailMailFetchGateway` / `PdfToCsvConverter` と違い、これは外部システムへの driven port では
 * なく**純粋なドメイン処理の関数型**である（他コンテキストの `services/` にも純粋関数を置く先例が
 * ある: `onboarding-auth/services/decideOperationStart.ts`）。実装は同じドメイン内の
 * `parseSmbcNotificationMail`（zod のみ・I/O 依存なし）。日次メール取込ワーカー（#414）が
 * 依存するのは本シグネチャだけなので、テストではスタブを、本文構造が変わったときは別実装を
 * 差し替えられる。
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
 *
 * 事後条件（08a §2）: 返す加盟店名は NFKC 正規化・空白圧縮・長音統一を適用済みであること
 * （OQ-23）。呼出し側は正規化せずそのまま取引候補に載せるため、ここで揃えないと同じ店が
 * 表記違いで別の店として扱われ、自動分類の学習も重複判定も効かなくなる。
 *
 * 一方、振込入金の**振込元名は本文の表記のまま**返す（NFKC 正規化以外を掛けない）。照合に使うのは
 * 残高・資産推移管理の入金用途判別で、そちら（08d）が `normalizeRemitterName` で正規化してから
 * 突き合わせる。加盟店名と対称に見えるが、正規化の担当が違う。
 */
export type SmbcNotificationMailParser = (
  input: SmbcNotificationMailParseInput,
) => SmbcMailParseResult
