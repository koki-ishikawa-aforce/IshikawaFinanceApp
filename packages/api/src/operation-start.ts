/**
 * 運用開始発火（08f §2「運用開始を発火する」「通知機能を有効化する」）の一元適用
 *
 * 夫婦両方の Phase2 完了が揃った時点で、両者を運用開始済みへ遷移させ `OperationStarted` を
 * 発行する（論点16）。続けて世帯の通知機能有効化の可否を判定し、成立していれば
 * `NotificationActivated` を発行してテストメッセージ配信（#36 のハンドラー）を起動する。
 *
 * 発火の起点は 1 つに絞れない。どの起点から呼んでも同じ結論になるよう、判定はドメイン
 * （`decideOperationStart` / `decideHouseholdNotificationActivation`）に置き、本モジュールは
 * 「読む → 保存する → 発行する」の手続きだけを担う。起点は次の 4 つ:
 *
 *  - `POST /api/onboarding/phase2/complete`（`routes/onboarding.ts`）— 主経路
 *  - `GET /api/onboarding/spouse-completion`（同）— 論点19 により相方の完了はポーリングしないため、
 *    遅れて画面を開いた側のこの検知が発火の機会になる
 *  - `POST /api/onboarding/phase1/notification`（同）— 運用開始後に通知有効化を要求された場合
 *  - LINE 友達追加・共通トークルーム参加の記録（`line-operation-records.ts`。自己申告 API と
 *    Webhook の両方がここを通る）— 通知有効化の前提が運用開始後に揃う場合の回復経路。
 *    運用開始済みのユーザーは web のオンボーディング画面を離れるため、上の 3 経路は再訪されない
 *
 * 冪等性: 判定は現在の状態のみに依存する。両者が運用開始済みなら遷移も発行も行わないため、
 * 何度呼んでも `OperationStarted` は 1 度しか出ない。片方の保存だけが済んだ状態からの再実行は
 * 残り 1 人を遷移させて回復する。通知機能有効化は世帯レベルの記録
 * （`HouseholdNotificationActivation`）が「発行済み」の唯一の根拠であり、**`NotificationActivated`
 * の発行が成功して初めて記録する**（#447）。発行が失敗した回は記録が残らないため、次の発火の
 * 起点でやり直せる（per-user の有効化状態の組み合わせから推測していた従来の作りでは、この回が
 * 「もう送った」と誤認され、テストメッセージが世帯へ二度と届かなかった）。
 *
 * この回復が効くのは**発行そのものが失敗した回に限る**。購読側（テストメッセージ配信）の失敗は
 * `safeSubscribe` が受け止めるため publish は成功し、LINE への送信が最終的に失敗した回
 * （配信サービスの `retry_abandoned`）でも記録は書かれる。その回のテストメッセージは本記録では
 * 回復しない（記録の確定を配信の到達まで遅らせるかは配信コンテキストとの結合に触れるため #590）。
 */
import { createHash } from 'node:crypto'
import {
  NotificationActivatedSchema,
  OperationStartedSchema,
  decideHouseholdNotificationActivation,
  decideOperationStart,
  lineOperationSettingsOf,
  recordHouseholdNotificationActivated,
  type AppUserRepository,
  type EventBus,
  type HouseholdMembers,
  type HouseholdNotificationActivationRepository,
  type OperationStartedHousehold,
  type SharedTalkRoomRepository,
} from '@warimaru/domain'
import { domainEventBase } from './event-handlers/index.js'

export interface OperationStartDeps {
  appUserRepository: AppUserRepository
  sharedTalkRoomRepository: SharedTalkRoomRepository
  /** 世帯としての通知機能有効化記録（テストメッセージを依頼済みかの唯一の根拠、#447） */
  householdNotificationActivationRepository: HouseholdNotificationActivationRepository
  eventBus: EventBus
}

/** 発火を試みた起点（ログで「どの操作から発火したか」を切り分けるために持ち回る） */
export type OperationStartTrigger =
  | 'phase2_complete'
  | 'spouse_completion_check'
  | 'notification_activation_request'
  | 'line_friend_added'
  | 'shared_talk_room_joined'

export interface OperationStartOptions {
  trigger: OperationStartTrigger
  at?: Date
}

/** 運用開始発火の結果（ログと呼出し元の判定用。API 応答には含めない） */
export interface OperationStartOutcome {
  /** 運用開始: 発火した / 既に発火済み / 条件を満たさない */
  operation: 'started' | 'already_started' | 'not_ready'
  /** 世帯の通知機能有効化: 発火した / 既に有効 / 条件を満たさない */
  notification: 'activated' | 'already_active' | 'not_ready'
}

/**
 * 運用開始の条件が揃っていれば発火する（揃っていなければ何もしない）。
 *
 * 保存・発行の失敗はそのまま呼出し元へ伝播させる（黙って落とすと「運用開始したのに通知が
 * 来ない」が無言で残る）。呼出し元の主目的を巻き込みたくない経路は `tryFireOperationStart`
 * を使い、失敗を記録したうえで処理を続ける。
 * イベント購読側の失敗は `safeSubscribe` が受け止めるため、ここには伝わらない。
 */
export async function fireOperationStartIfReady(
  deps: OperationStartDeps,
  options: OperationStartOptions,
): Promise<OperationStartOutcome> {
  const { trigger } = options
  const at = options.at ?? new Date()
  const [honey, darling] = await Promise.all([
    deps.appUserRepository.findByRole('honey'),
    deps.appUserRepository.findByRole('darling'),
  ])
  const sharedTalkRoom = await deps.sharedTalkRoomRepository.find()
  const members: HouseholdMembers = { honey, darling }

  const decision = decideOperationStart(members, at)
  if (decision.kind === 'not_ready') {
    return { operation: 'not_ready', notification: 'not_ready' }
  }

  if (decision.kind === 'start') {
    for (const user of decision.transitioned) {
      await deps.appUserRepository.save(user)
    }
    const event = OperationStartedSchema.parse({
      ...domainEventBase(at),
      type: 'OperationStarted',
      honeyUserId: decision.household.honey.common.userId,
      darlingUserId: decision.household.darling.common.userId,
      operationStartedAt: decision.operationStartedAt,
    })
    await deps.eventBus.publish(event)
    // 発火は世帯に一度きりで、購読者を持たない現状ではここ以外に痕跡が残らない。
    // 「テスト送信が来ない」の切り分けに要るため、状態が動いた回だけ記録する
    console.info(
      `[onboarding] 運用開始を発火した（trigger=${trigger}, event=${event.eventId}, ` +
        `startedAt=${decision.operationStartedAt.toISOString()}）`,
    )
  }
  const operation = decision.kind === 'start' ? 'started' : 'already_started'

  // 「もう依頼したか」の根拠となる世帯レベルの記録。運用開始の遷移とは独立なので、
  // 大半の呼び出しが返る `not_ready` の後ろで読む（発火の起点は 4 つあり毎操作で通る）
  const householdActivation = await deps.householdNotificationActivationRepository.find()
  const activation = decideHouseholdNotificationActivation(
    decision.household,
    sharedTalkRoom,
    householdActivation,
    at,
  )
  if (activation.kind === 'already_activated') {
    return { operation, notification: 'already_active' }
  }
  if (activation.kind === 'not_ready') {
    // 運用開始したのにテスト送信が起きない状態は、利用者からは「設定したのに何も来ない」に見える。
    // 前提が欠けたまま止まったことを追えるようにしておく（回復は前提が揃ったときの再発火）。
    // 記録は発火した回だけに絞る — 前提が欠けたままの再発火は起点ごとに何度も起きるため、
    // 毎回記録すると本当に見たい警告が埋もれる
    if (decision.kind === 'start') {
      console.warn(
        `[onboarding] 運用開始したが世帯の通知機能を有効化できない（blocker=${activation.blocker}, ` +
          `trigger=${trigger}, talkRoom=${sharedTalkRoom.kind}, ${friendAddTraceOf(decision.household)}）— ` +
          '前提（友だち追加・共通トークルーム参加）が揃った時点の再発火で回復する',
      )
    }
    return { operation, notification: 'not_ready' }
  }

  for (const user of activation.changed) {
    await deps.appUserRepository.save(user)
  }
  const event = NotificationActivatedSchema.parse({
    ...domainEventBase(at),
    type: 'NotificationActivated',
    talkRoomId: activation.talkRoomId,
    activatedAt: activation.activatedAt,
  })
  try {
    await deps.eventBus.publish(event)
  } catch (e) {
    // 世帯レベルの有効化記録はまだ書いていないため、次の発火の起点でやり直される（#447）。
    // 自動で回復する失敗であっても握りつぶさず、切り分けのために記録してから呼出し元へ返す
    console.error(
      `[onboarding] 世帯の通知機能有効化イベントの発行に失敗した（${e instanceof Error ? e.name : 'unknown'}, ` +
        `trigger=${trigger}, event=${event.eventId}）— ` +
        '世帯の有効化は未記録のため、次の発火の起点で再試行される',
    )
    throw e
  }
  // 発行が成功して初めて「依頼済み」を記録する（#447）
  try {
    await deps.householdNotificationActivationRepository.save(
      recordHouseholdNotificationActivated(householdActivation, activation.activatedAt),
    )
  } catch (e) {
    // ここまで来た時点でイベントは発行済み（テストメッセージも送信済み）。「発火に失敗した」と
    // だけ記録されると運用者は「送られていない」と誤読するため、実態を明示してから返す
    console.error(
      `[onboarding] 世帯の通知機能有効化の記録に失敗した（${e instanceof Error ? e.name : 'unknown'}, ` +
        `trigger=${trigger}, event=${event.eventId}, activatedAt=${activation.activatedAt.toISOString()}）— ` +
        'イベントは発行済み。次の起点で再発行されるが、配信側の冪等性キー（トークルーム × 有効化日時）は' +
        '変わらないためテストメッセージが二重に届くことはない',
    )
    throw e
  }
  console.info(
    `[onboarding] 世帯の通知機能を有効化した（trigger=${trigger}, event=${event.eventId}, ` +
      `activatedAt=${activation.activatedAt.toISOString()}）`,
  )
  return { operation, notification: 'activated' }
}

/**
 * 友だち追加の欠けを追うための短縮識別子つきの記述。
 * LINE userID は個人を辿れる識別子（PII）のためそのままは出さず、復元できない形へ潰す
 * （`routes/line-webhook.ts` の traceId と同じ方式）。
 */
function friendAddTraceOf(household: OperationStartedHousehold): string {
  return (['honey', 'darling'] as const)
    .map(role => {
      const user = household[role]
      const traceId = createHash('sha256').update(user.common.userId).digest('hex').slice(0, 8)
      return `${role}=${traceId}:${lineOperationSettingsOf(user).friendAdd.kind}`
    })
    .join(', ')
}

/**
 * 呼出し元の主目的を巻き込まずに発火を試みる。
 *
 * 発火は「本人の要求そのもの」ではない副次処理で、失敗しても本人の操作（Phase2 完了の記録・
 * 友だち追加の記録など）は既に永続化されている。ここで例外を投げ返すと、利用者には自分の操作が
 * 失敗したように見える一方、状態は進んだままになる。発火には複数の起点があり次の操作で回復
 * できるため、失敗は記録して処理を続ける（無言では落とさない）。
 */
export async function tryFireOperationStart(
  deps: OperationStartDeps,
  options: OperationStartOptions,
): Promise<void> {
  try {
    await fireOperationStartIfReady(deps, options)
  } catch (e) {
    console.error(
      `[onboarding] 運用開始の発火に失敗した（${e instanceof Error ? e.name : 'unknown'}, ` +
        `trigger=${options.trigger}）— 次の発火の起点で再試行される`,
    )
  }
}
