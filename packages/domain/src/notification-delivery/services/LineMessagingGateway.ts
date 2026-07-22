/**
 * LINE Messaging API ゲートウェイ（外部システムへの driven port、ACL 翻訳層）
 * @see docs/domain/08g-ul-通知配信.md §2
 *
 * behavior LINE push API を呼び出す = 配信メッセージ AND Channel_Access_Token保管参照
 *   -> 送信成功メッセージ OR 送信失敗メッセージ AND LINE配信ログ
 *
 * Conformist（順応者）: LINE Messaging API の仕様に従う薄い層で、独自の判断ロジックは
 * 持たない。Channel Access Token の解決（マスタ管理の保管参照 → Parameter Store 復号）は
 * 実装側（api 層）の責務で、ドメインにトークン実体を持ち込まない。
 * 送信 payload は成否によらず返却し、呼出し側が LINE 配信ログへ凍結する（OQ-34）。
 */
import type { LineMessageId } from '../../shared/ids'
import type { SendFailureReason } from '../aggregates/DeliveryMessage'
import type { DeliveryContent } from '../value-objects/DeliveryContent'
import type { DeliveryTarget } from '../value-objects/DeliveryTarget'

export type LinePushResult =
  | { kind: 'success'; lineMessageId: LineMessageId }
  | { kind: 'failure'; failureReason: SendFailureReason; detail: string }

export interface LinePushOutcome {
  result: LinePushResult
  /** 実際に送信を試みた payload（json 文字列）。配信ログの凍結に使う */
  sentPayloadJson: string
}

export interface LineMessagingGateway {
  /** 配信先へ push メッセージを送信する */
  sendPush(target: DeliveryTarget, content: DeliveryContent): Promise<LinePushOutcome>
}
