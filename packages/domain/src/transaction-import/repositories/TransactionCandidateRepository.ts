/**
 * 取引候補 Repository I/F
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.3
 *
 * 重複除外: findByGmailMessageId（利用者 + Gmail_message_ID 完全一致）と
 * findByTripleMatch（発生日 + 金額 + 加盟店名〔NFKC 正規化済み〕、OQ-23 / OQ-7）で
 * 生成前チェックを行う（Phase 5 M-B）。
 *
 * findByGmailMessageId が利用者を受け取るのは、Gmail message ID が受信箱ごとの採番で
 * アカウント間の一意性を保証しないため（#487）。夫婦それぞれのメールに同じ番号が振られても
 * 双方を取り込めるよう、重複判定と DB の一意制約を「利用者 + メールの番号」で閉じる。
 */
import type {
  AmazonOrderId,
  TransactionCandidateId,
  UserId,
  GmailMessageId,
  UploadFileId,
} from '../../shared/ids'
import type { Money } from '../../shared/value-objects/Money'
import type {
  NormalTransactionCandidate,
  TransactionCandidate,
} from '../aggregates/TransactionCandidate'

export interface TransactionCandidateRepository {
  findById(id: TransactionCandidateId): Promise<TransactionCandidate | null>
  findByGmailMessageId(
    userId: UserId,
    gmailMessageId: GmailMessageId,
  ): Promise<TransactionCandidate | null>
  findByTripleMatch(
    userId: UserId,
    occurredOn: Date,
    amount: Money,
    merchantName: string,
  ): Promise<TransactionCandidate | null>
  /** CSV 取込ファイル由来の候補一覧（importSource.kind = 'csv' の csvFileId 一致） */
  findByCsvFileId(csvFileId: UploadFileId): Promise<TransactionCandidate[]>
  /** PDF 取込ファイル由来の候補一覧（importSource.kind = 'pdf' の pdfFileId 一致） */
  findByPdfFileId(pdfFileId: UploadFileId): Promise<TransactionCandidate[]>
  /**
   * メール由来かつ通常（未突合・未確定）の候補を、発生日の範囲で引く。
   *
   * Amazon 突合（08a §2）が使う。突合の相手探しでは注文日の前後 3 日を、SMBC 先着の
   * タイムアウト掃き出しでは 3 日より前を範囲にする。「メール由来」に絞るのは、CSV / PDF 由来の
   * 候補を Amazon 突合の対象にしないため（突き合わせる Gmail message ID を持たない）。
   *
   * `occurredTo` は含む。`occurredFrom` を省くと下限なし（過去に取り込んだまま突合されずに
   * 残っている候補を取りこぼさない）。
   */
  findEmailSourcedNormalCandidates(
    userId: UserId,
    range: { occurredFrom?: Date; occurredTo: Date },
  ): Promise<NormalTransactionCandidate[]>
  /**
   * 渡した Amazon 注文ID のうち、既にこのユーザーの取引候補へ突合済みのもの。
   *
   * 日次取込は過去 5 日ぶんのメールを毎回取り直すため、突合済みの注文確認メールも再び手元に
   * 来る。これを除かないと、済んだ注文が新しいカード利用通知の突合相手を取り合って「一意に
   * 決まらない」を作り、正当な突合を潰す。
   */
  findMatchedAmazonOrderIds(
    userId: UserId,
    amazonOrderIds: readonly AmazonOrderId[],
  ): Promise<AmazonOrderId[]>
  save(candidate: TransactionCandidate): Promise<void>
}
