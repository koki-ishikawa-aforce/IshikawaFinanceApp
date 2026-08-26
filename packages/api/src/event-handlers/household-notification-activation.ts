/**
 * 世帯通知有効化記録の確定（08f §1「世帯通知有効化記録」／§2「世帯通知有効化を記録する」、#590）
 *
 * チェーン: TestMessageSent（通知配信がテストメッセージの配信確定を検知。実送信 or 冪等スキップ）
 *   → 世帯通知有効化記録に有効化日時を書く
 *
 * 「もう送ったか」の根拠を、`NotificationActivated` の発行成功（#447）からさらに一歩進め、
 * 通知配信での配信確定まで遅らせる（#590 A）。発行は成功したが LINE への送信が最終的に失敗した回
 * （配信サービスの `retry_abandoned`）は本ハンドラーが起きないため記録が残らず、次の発火の起点で
 * やり直せる。
 *
 * 冪等性: `recordHouseholdNotificationActivated` は有効化済みなら上書きしない。`TestMessageSent`
 * は同一の配信確定に対して複数回発行されうる（前提が揃うたびに再発行される `NotificationActivated`
 * ぶんだけ発行されうる、`notification-delivery.ts` 参照）が、書き込みは初回だけ効く。
 */
import type {
  EventBus,
  HouseholdNotificationActivationRepository,
  TestMessageSent,
} from '@warimaru/domain'
import { recordHouseholdNotificationActivated } from '@warimaru/domain'
import { safeSubscribe } from './safe-subscribe.js'

export interface HouseholdNotificationActivationHandlerDeps {
  householdNotificationActivationRepository: HouseholdNotificationActivationRepository
}

export function registerHouseholdNotificationActivationEventHandlers(
  eventBus: EventBus,
  deps: HouseholdNotificationActivationHandlerDeps,
): void {
  safeSubscribe<TestMessageSent>(eventBus, 'TestMessageSent', async event => {
    const current = await deps.householdNotificationActivationRepository.find()
    await deps.householdNotificationActivationRepository.save(
      recordHouseholdNotificationActivated(current, event.activatedAt),
    )
  })
}
