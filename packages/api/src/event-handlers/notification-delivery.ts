/**
 * 通知配信コンテキストのイベントハンドラー（#36）
 *
 * チェーン: NotificationActivated（運用開始で世帯の通知機能が有効化）
 *   → テストメッセージを共通トークルームへ送信（08g §2「テストメッセージを送信する」、
 *      配信成功で運用開始の最終確認）→ TestMessageSent を発火
 *
 * 冪等性: 配信サービスの冪等性キー（トークルーム × 有効化日時）で担保する。
 * at-least-once なイベント再発行では同一キーの配信ログが既に存在するためスキップされる。
 *
 * TestMessageSent は `sent`（今回実際に送った）だけでなく `already_delivered`（冪等性キーが
 * 既に確定済みでスキップした）でも発行する。オンボーディング・認証はこのイベントを「配信確定」の
 * 唯一の合図として世帯通知有効化記録を書く（#590）。`NotificationActivated` は前提が揃うたびに
 * 再発行されうる（08f §2）が、その再発行のたびに配信確定を伝え直さないと、記録が書かれる前に
 * ちょうど再発行が止まった回だけ記録が永久に欠けたままになる。実際の LINE 送信は冪等性キーで
 * 1 回しか起きない（`already_delivered` では `deliver` は送信しない）ため、再発行はイベントの
 * 発行回数を増やすだけで実害はない。
 */
import type { EventBus, NotificationActivated } from '@warimaru/domain'
import {
  DeliveryContentSchema,
  DeliveryTargetSchema,
  TestMessageSentSchema,
} from '@warimaru/domain'
import type { NotificationDeliveryService } from '../notification/delivery-service.js'
import { domainEventBase } from './event-base.js'
import { safeSubscribe } from './safe-subscribe.js'

const TEST_MESSAGE_BODY = [
  '割まるのテスト送信です🎉',
  'このメッセージが届いていれば、LINE 通知の設定は完了しています。',
].join('\n')

export interface NotificationDeliveryHandlerDeps {
  notificationDeliveryService: NotificationDeliveryService
}

export function registerNotificationDeliveryEventHandlers(
  eventBus: EventBus,
  deps: NotificationDeliveryHandlerDeps,
): void {
  safeSubscribe<NotificationActivated>(eventBus, 'NotificationActivated', async event => {
    const outcome = await deps.notificationDeliveryService.deliver({
      target: DeliveryTargetSchema.parse({
        kind: 'shared_talk_room',
        talkRoomId: event.talkRoomId,
      }),
      content: DeliveryContentSchema.parse({ kind: 'plain_text', textBody: TEST_MESSAGE_BODY }),
      purpose: 'test_message',
      idempotencyKey: `test_message:${event.talkRoomId}:${event.activatedAt.toISOString()}`,
    })
    if (outcome.kind === 'sent' || outcome.kind === 'already_delivered') {
      await eventBus.publish(
        TestMessageSentSchema.parse({
          ...domainEventBase(),
          type: 'TestMessageSent',
          deliveryMessageId: outcome.log.deliveryMessageId,
          talkRoomId: event.talkRoomId,
          activatedAt: event.activatedAt,
        }),
      )
    }
  })
}
