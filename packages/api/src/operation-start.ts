/**
 * 運用開始発火（08f §2「運用開始を発火する」「通知機能を有効化する」）の一元適用
 *
 * 夫婦両方の Phase2 完了が揃った時点で、両者を運用開始済みへ遷移させ `OperationStarted` を
 * 発行する（論点16）。続けて世帯の通知機能有効化の可否を判定し、成立していれば
 * `NotificationActivated` を発行してテストメッセージ配信（#36 のハンドラー）を起動する。
 *
 * 発火の起点は 1 つに絞れない — 自分の Phase2 完了、配偶者完了検知の画面ロード（論点19: 相方の
 * 完了はポーリングしないため、遅れて完了した側の画面ロードが唯一の検知機会）、LINE 友達追加・
 * 共通トークルーム参加の記録（通知有効化の前提が後から揃う場合）。どの起点から呼んでも同じ結論に
 * なるよう、判定はドメイン（`decideOperationStart` / `decideHouseholdNotificationActivation`）に
 * 置き、本モジュールは「読む → 保存する → 発行する」の手続きだけを担う。
 *
 * 冪等性: 判定は現在の状態のみに依存する。両者が運用開始済みなら遷移も発行も行わないため、
 * 何度呼んでも `OperationStarted` は 1 度しか出ない。片方の保存だけが済んだ状態からの再実行は
 * 残り 1 人を遷移させて回復する。通知機能有効化は世帯レベルの記録を持たないため、呼び出し前後の
 * 「無効 → 有効」への変化を見て二重発行を防ぐ（`isHouseholdNotificationActive`）。
 */
import {
  NotificationActivatedSchema,
  OperationStartedSchema,
  decideHouseholdNotificationActivation,
  decideOperationStart,
  isHouseholdNotificationActive,
  type AppUserRepository,
  type EventBus,
  type HouseholdMembers,
  type SharedTalkRoomRepository,
} from '@warimaru/domain'
import { domainEventBase } from './event-handlers/index.js'

export interface OperationStartDeps {
  appUserRepository: AppUserRepository
  sharedTalkRoomRepository: SharedTalkRoomRepository
  eventBus: EventBus
}

/** 運用開始発火の結果（呼出し元のログ・テスト用。API 応答には含めない） */
export interface OperationStartOutcome {
  /** 運用開始: 発火した / 既に発火済み / 条件を満たさない */
  operation: 'started' | 'already_started' | 'not_ready'
  /** 世帯の通知機能有効化: 発火した / 既に有効 / 条件を満たさない */
  notification: 'activated' | 'already_active' | 'not_ready'
}

/**
 * 運用開始の条件が揃っていれば発火する（揃っていなければ何もしない）。
 *
 * 呼出し元の処理を失敗させないため、例外は投げない設計にはしていない — 保存・発行の失敗は
 * そのまま呼出し元へ伝播させる（黙って落とすと「運用開始したのに通知が来ない」が無言で残る）。
 * イベント購読側の失敗は `safeSubscribe` が受け止めるため、ここには伝わらない。
 */
export async function fireOperationStartIfReady(
  deps: OperationStartDeps,
  at: Date = new Date(),
): Promise<OperationStartOutcome> {
  const [honey, darling] = await Promise.all([
    deps.appUserRepository.findByRole('honey'),
    deps.appUserRepository.findByRole('darling'),
  ])
  const sharedTalkRoom = await deps.sharedTalkRoomRepository.find()
  const members: HouseholdMembers = { honey, darling }

  // 通知機能有効化の「発行済み」判定に使う。運用開始の遷移より前の状態で評価する
  const notificationWasActive = isHouseholdNotificationActive(members, sharedTalkRoom)

  const decision = decideOperationStart(members, at)
  if (decision.kind === 'not_ready') {
    return { operation: 'not_ready', notification: 'not_ready' }
  }

  if (decision.kind === 'start') {
    for (const user of decision.transitioned) {
      await deps.appUserRepository.save(user)
    }
    await deps.eventBus.publish(
      OperationStartedSchema.parse({
        ...domainEventBase(at),
        type: 'OperationStarted',
        honeyUserId: decision.household.honey.common.userId,
        darlingUserId: decision.household.darling.common.userId,
        operationStartedAt: decision.operationStartedAt,
      }),
    )
  }
  const operation = decision.kind === 'start' ? 'started' : 'already_started'
  if (notificationWasActive) return { operation, notification: 'already_active' }

  const activation = decideHouseholdNotificationActivation(decision.household, sharedTalkRoom, at)
  if (activation.kind === 'not_ready') {
    // 運用開始したのにテスト送信が起きない状態は、利用者からは「設定したのに何も来ない」に見える。
    // 前提が欠けたまま止まったことを追えるようにしておく（回復は前提が揃ったときの再発火）。
    // 記録は発火した回だけに絞る — 前提が欠けたままの再発火は画面ロードのたびに起きるため、
    // 毎回記録すると本当に見たい警告が埋もれる
    if (decision.kind === 'start') {
      console.warn(
        `[onboarding] 運用開始したが世帯の通知機能を有効化できない（${activation.blocker}）— ` +
          '前提が揃った時点の再発火で回復する',
      )
    }
    return { operation, notification: 'not_ready' }
  }

  for (const user of activation.changed) {
    await deps.appUserRepository.save(user)
  }
  await deps.eventBus.publish(
    NotificationActivatedSchema.parse({
      ...domainEventBase(at),
      type: 'NotificationActivated',
      talkRoomId: activation.talkRoomId,
      activatedAt: activation.activatedAt,
    }),
  )
  return { operation, notification: 'activated' }
}
