/**
 * 世帯通知有効化記録の確定（08f §1「世帯通知有効化記録」／§2「世帯通知有効化を記録する」、#590）
 *
 * チェーン: TestMessageSent（通知配信がテストメッセージの配信確定を検知。実送信 or 冪等スキップ）
 *   → 世帯通知有効化記録に有効化日時を書く
 *
 * 「もう送ったか」の根拠を、`NotificationActivated` の発行成功（#447）からさらに一歩進め、
 * 通知配信での配信確定まで遅らせる（#590 A）。発行は成功したが LINE への送信が最終的に失敗した回
 * （配信サービスの `retry_abandoned`）は本ハンドラーが起きないため記録が残らない。
 *
 * 冪等性: `recordHouseholdNotificationActivated` は有効化済みなら上書きしない。`TestMessageSent`
 * は同一の配信確定に対して複数回発行されうる（前提が揃うたびに再発行される `NotificationActivated`
 * ぶんだけ発行されうる、`notification-delivery.ts` 参照）が、書き込みは初回だけ効く。
 *
 * 回復性の限界: 前提（運用開始・友だち追加・共通トークルーム参加）が揃うたびに `NotificationActivated`
 * は再発行されるため、記録がまだ無い状態で配信確定を再度検知すればここでやり直せる。ただし本記録の
 * 保存（DB 書き込み）そのものが失敗した場合、運用開始後の利用者はオンボーディング画面を離れるため、
 * この一連の処理を再び走らせるきっかけが実質無い（#706）。失敗時は世帯・日時を特定できるログを
 * 残すに留め、拾い直す仕組み自体は設計判断が要るため #706 として切り出した。
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
    try {
      const current = await deps.householdNotificationActivationRepository.find()
      await deps.householdNotificationActivationRepository.save(
        recordHouseholdNotificationActivated(current, event.activatedAt),
      )
    } catch (e) {
      // safeSubscribe の汎用ログ(eventId のみ)は、実際には LINE 送信済みなのに記録だけが
      // 欠けたことを切り分けるのに不十分。世帯を特定できる talkRoomId / activatedAt を明示し、
      // 「送信は完了している」実態を運用者が誤読しないようにしてから safeSubscribe へ委ねる
      console.error(
        `[onboarding] 世帯通知有効化記録の保存に失敗した(${e instanceof Error ? e.name : 'unknown'}, ` +
          `talkRoomId=${event.talkRoomId}, activatedAt=${event.activatedAt.toISOString()}, ` +
          `deliveryMessageId=${event.deliveryMessageId})— ` +
          'テストメッセージ自体は配信確定済み。記録が書けていないため、次にこの世帯の配信確定を ' +
          '検知するまで「もう送ったか」の判定に使えない',
      )
      throw e
    }
  })
}
