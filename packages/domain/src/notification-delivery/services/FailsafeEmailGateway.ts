/**
 * フェイルセーフメール送信ゲートウェイ（外部システムへの driven port）
 * @see docs/domain/08g-ul-通知配信.md §2
 *
 * behavior フェイルセーフメールを送信する = しきい値到達済み AND 宛先メールアドレス
 *   -> フェイルセーフメール AND フェイルセーフメール送信イベント OR フェイルセーフ送信失敗イベント
 *
 * Conformist（順応者）: SMTP / SES 等の標準送信プロバイダに従い独自ロジックを持たない
 * （OQ-14。プロバイダの選択は実装側 = api 層の責務）。
 */
import type { EmailSendFailureReason, SendingFailsafeEmail } from '../aggregates/FailsafeEmail'

export type FailsafeEmailSendResult =
  | { kind: 'success'; providerRef: string }
  | { kind: 'failure'; failureReason: EmailSendFailureReason; detail: string }

export interface FailsafeEmailGateway {
  send(email: SendingFailsafeEmail): Promise<FailsafeEmailSendResult>
}
