/**
 * イベントチェーン: Gmail_OAuth失効検知 → OAuth 失効通知の LINE 個人 DM 配信（#392）
 *
 * 08g §2「OAuth失効通知を個人DMに配信する」の発火元。取引取込が発行する
 * GmailOauthRevocationDetected を購読し、失効した本人にだけ再認可への導線を届ける
 * （OQ-2: 通知は LINE 個人 DM のみ。メールフェイルセーフ対象外 — 配信サービス側の
 * `isFailsafeCovered` がこの用途を除外している）。
 *
 * 通知機能の有効化状態は見ない: この通知は再認可されるまで自動取込が止まり続ける
 * 「復旧の唯一の呼びかけ」で、08g §2 も有効化を事前条件にしていない（月次サマリ・
 * テストメッセージとの違い）。
 *
 * 冪等性と再送: 冪等性キーは ユーザー × 検知日時。イベントは at-least-once で再配信され
 * うる（同一の検知日時 → already_delivered で 2 通目は送らない）ほか、送信に失敗した回は
 * 未達が確定した失敗なら配信が確定せず（#441-A）、日次バッチが失効状態を見るたびに同じ
 * 検知日時で再発行するイベント（`daily-mail-import.ts` の対象外分岐）が翌日の再送機会になる。
 * 再認可後に改めて失効した場合は検知日時が変わり、新しい通知として届く。
 */
import type { EventBus, GmailOauthRevocationDetected } from '@warimaru/domain'
import { DeliveryTargetSchema, OauthRevocationNoticeDeliveredSchema } from '@warimaru/domain'
import type { NotificationDeliveryService } from '../notification/delivery-service.js'
import type { DeepLinkBuilder } from '../notification/deep-links.js'
import { buildOauthRevocationNoticeContent } from '../notification/message-content.js'
import { domainEventBase } from './event-base.js'
import { safeSubscribe } from './safe-subscribe.js'

export interface OauthRevocationNoticeHandlerDeps {
  notificationDeliveryService: NotificationDeliveryService
  deepLinks: DeepLinkBuilder
}

export function registerOauthRevocationNoticeEventHandlers(
  eventBus: EventBus,
  deps: OauthRevocationNoticeHandlerDeps,
): void {
  safeSubscribe<GmailOauthRevocationDetected>(
    eventBus,
    'GmailOauthRevocationDetected',
    async event => {
      const outcome = await deps.notificationDeliveryService.deliver({
        target: DeliveryTargetSchema.parse({ kind: 'personal_dm', userId: event.userId }),
        content: () => buildOauthRevocationNoticeContent(deps.deepLinks),
        purpose: 'oauth_revocation_notice',
        idempotencyKey: `oauth_revocation_notice:${event.userId}:${event.detectedAt.toISOString()}`,
      })
      if (outcome.kind === 'failed') {
        // 単発失敗はログのみ（論点23）。未達が確定した失敗なら、日次バッチの再発行が翌日の
        // 再送機会になる（このハンドラーのモジュールコメントを参照）
        console.warn(
          '[notification] OAuth 失効通知の配信に失敗した。' +
            '未達が確定した失敗なら日次バッチの再発行で再送される',
        )
      }
      if (outcome.kind !== 'sent') return

      await eventBus.publish(
        OauthRevocationNoticeDeliveredSchema.parse({
          ...domainEventBase(),
          type: 'OauthRevocationNoticeDelivered',
          deliveryMessageId: outcome.message.common.deliveryMessageId,
          userId: event.userId,
        }),
      )
    },
  )
}
