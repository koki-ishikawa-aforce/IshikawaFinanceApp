/**
 * Gmail メール取得ゲートウェイ（外部システムへの driven port、ACL 翻訳層）
 * @see docs/domain/08a-ul-取引取込.md §2「Gmail からメールを取得する」/ §4（Gmail は ACL 越しの外部システム）
 *
 * behavior Gmail からメールを取得する = Gmail_OAuth_トークン参照 AND 取込対象期間
 *   -> List<SMBC通知メール本文> AND List<Amazon注文確認メール本文> AND メール取得失敗?
 *
 * Repository / Query / `PdfToCsvConverter` と同じく domain が宣言する driven port。Gmail API の
 * 呼び出し・OAuth アクセストークンの更新・MIME 本文の取り出しはすべて実装側（api 層）の責務で、
 * ドメインにはトークン実体を持ち込まない（保管先パス `ParameterStorePath` のみ受け取る。
 * `GmailOAuthGateway` が保管した先を指す）。
 *
 * 本文のパース（`SmbcMailParseResult` への変換）はこの port の責務ではない。ここでの出力は
 * 「構造を持たない外部表現」（08a §1 の `SMBC通知メール本文` / `Amazon注文確認メール本文`）に
 * とどめ、パースは純粋なドメイン処理として別に置く（#415）。
 *
 * 失敗は例外ではなく戻り値で返す。**トークン失効（認可エラー）とその他の取得失敗を型で区別する**
 * のが本 port の要点で、失効は再認可の導線（#392）を出す必要がある一方、その他の失敗は次回の
 * 日次バッチで自然に回復しうる。例外に混ぜると呼出し側がメッセージ文字列で判別することになり、
 * 「一時的な通信断でユーザーに再認可を求める」誤りが起こる。
 */
import type { GmailMessageId, UserId } from '../../shared/ids'
import type { ParameterStorePath } from '../../shared/value-objects/ParameterStorePath'
import type { ImportTargetPeriod } from '../aggregates/DailyMailImportBatch'

/**
 * メール種別ヒント（08a §1 `data メール種別ヒント`）
 *
 * 件名・送信元から類推した暫定種別で、確定はパース成功後（08a §1 の注記）。実運用で観測されて
 * いない種別（`bank_withdrawal` / `card_refund`）も語彙としては保持する（#415 の実メール調査:
 * 出金通知・返金通知は届いていない）。実装が判別できなければ `unknown` を返し、パース側が
 * 本文構造で決める。
 */
export type MailKindHint =
  | 'card_usage'
  | 'bank_deposit'
  | 'bank_withdrawal'
  | 'card_settlement_confirmed'
  | 'card_refund'
  | 'unknown'

/** SMBC 通知メール本文（08a §1 の外部表現。パース前なので本文は文字列のまま） */
export interface SmbcNotificationMailBody {
  gmailMessageId: GmailMessageId
  receivedAt: Date
  subject: string
  /** プレーンテキスト本文（HTML しか無いメールは実装側が HTML をそのまま載せる） */
  body: string
  kindHint: MailKindHint
}

/** Amazon 注文確認メール本文（08a §1 の外部表現） */
export interface AmazonOrderConfirmationMailBody {
  gmailMessageId: GmailMessageId
  receivedAt: Date
  subject: string
  body: string
}

/**
 * メール取得失敗（08a §2 `data メール取得失敗 = 失敗理由 AND 検知日時 AND OAuth失効状態`）
 *
 * `OAuth失効状態` は判別子（`kind`）で表す。`oauth_revocation_detected` は
 * `GmailOAuthToken` の失効検知遷移と再認可導線（#392）の起点になるため、その他の取得失敗と
 * 取り違えてはならない。
 *
 * `detail` は呼出し側がログ・通知に載せるため、実装は**シークレット・PII・メール本文・
 * Parameter Store のパスを含めない**（トークン保管パスにはユーザーID が、メール本文には
 * 金額と氏名が含まれる）。障害の種別が分かる短い文言に絞る。
 */
export type MailFetchFailure =
  | {
      kind: 'oauth_revocation_detected'
      detail: string
      detectedAt: Date
    }
  | {
      /** 通信断・API 障害・レート制限・本文取得の失敗など、認可以外の取得失敗 */
      kind: 'other_fetch_failure'
      detail: string
      detectedAt: Date
      /**
       * 同じ取得をやり直せば結果が変わりうるか。一時障害（5xx・429・タイムアウト・通信断）は
       * true、設定不備や応答構造の不正など、やり直しても直らないものは false。日次バッチは
       * 翌日も同じ期間を再走査する（過去 5 日再スキャン、OQ-31）ため、false でも取りこぼしは
       * 再走査で回収されるが、監視上「待てば直る」かを区別できるようにしておく。
       */
      retryable: boolean
    }

export interface MailFetchRequest {
  /**
   * 誰の受信箱を読むか。08a L20-23 の `data Gmail_OAuth_トークン参照 = ユーザーID` に対応する
   * 借用形で、`GmailOAuthTokenRef`（オンボーディング・認証）と同じ「ユーザーID + 保管先」の組。
   * 夫婦 2 人分のバッチが同じ port を使うため、取得結果と持ち主の対応付けを呼出し側の記憶に
   * 委ねない（取り違えると相手の個人明細が本人の取引候補として取り込まれる）。
   */
  userId: UserId
  /** Gmail OAuth トークンの保管先（トークン実体はドメインに持ち込まない） */
  tokenStoreRef: ParameterStorePath
  /** 取込対象期間（過去 5 日再走査、OQ-31。重複は Gmail message ID で除外する） */
  period: ImportTargetPeriod
}

/**
 * 取得結果。部分成功は表現しない（片方の取得に失敗した状態で「取得できた分だけ」を返すと、
 * 取りこぼしを完了として記録してしまう）。実装はどちらかの取得に失敗した時点で失敗を返す。
 */
export type MailFetchResult =
  | {
      ok: true
      smbcMails: readonly SmbcNotificationMailBody[]
      amazonMails: readonly AmazonOrderConfirmationMailBody[]
    }
  | { ok: false; failure: MailFetchFailure }

export interface GmailMailFetchGateway {
  /** 取込対象期間の SMBC 通知メール / Amazon 注文確認メールを取得する */
  fetchMails(request: MailFetchRequest): Promise<MailFetchResult>
}
