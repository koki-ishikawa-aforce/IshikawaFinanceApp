/**
 * CSV 取込リマインダーの配信処理（#389）
 *
 * 08g §2「CSV取込リマインダーを送信する」/「リマインダーの停止を判定する」の発火元。
 * 毎月 5 日から CSV 取込完了まで、共通トークルームへ日次でリマインダーを配信する。
 *
 * 起動は EventBridge → Lambda のスケジューラが担う（#35 / #416）。本モジュールは
 * 「スケジューラから呼び出せる関数」までを提供し、スケジュール定義そのものは持たない。
 *
 * 冪等性（スケジューラの二重起動・手動再実行に耐える）:
 *  - 配信は「共通トークルーム × 対象月 × JST 暦日」の冪等性キーで 1 日 1 通に固定する
 *  - 停止は「共通トークルーム × 対象月」の冪等性キーで 1 回に固定する。これにより
 *    取込完了後に毎日実行されても ReminderStopped は 1 度しか発火しない
 *
 * 日付は JST で判定する（利用者の「5 日」は JST の暦日）。判定規則と定数はドメインの
 * `judgeReminderWindow` / `jstCalendarParts` に置き、ここでは呼ぶだけにする。
 */
import type {
  AppUserRepository,
  CsvImportStatusQuery,
  DeliverySkipReason,
  EventBus,
  ReminderContinuationJudgment,
  ReminderStopReason,
  SharedTalkRoomRepository,
  TalkRoomId,
  YearMonth,
} from '@warimaru/domain'
import {
  DeliveryTargetSchema,
  ReminderSentSchema,
  ReminderStoppedSchema,
  YearMonthSchema,
  combineReminderJudgments,
  isNotificationActivated,
  joinedTalkRoomIdOf,
  jstCalendarParts,
  jstYearMonthOf,
  judgeReminderContinuation,
  judgeReminderWindow,
} from '@warimaru/domain'
import type { AppDeps } from '../composition-root.js'
import type { NotificationDeliveryService } from './delivery-service.js'
import { createNotificationDeliveryService } from './delivery-service.js'
import type { DeepLinkBuilder } from './deep-links.js'
import { createDeepLinkBuilder } from './deep-links.js'
import { buildCsvImportReminderContent } from './message-content.js'
import { domainEventBase } from '../event-handlers/event-base.js'

/** JST 暦日のキー（YYYY-MM-DD）。1 日 1 通の冪等性キーに使う */
function jstDateKey(at: Date): string {
  const { year, month, day } = jstCalendarParts(at)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export type CsvImportReminderOutcome =
  /** 当月 5 日より前のため対象外（08g §2 の事前条件） */
  | { kind: 'before_start_day'; dayOfMonth: number }
  /** 対象月が当月ではない（スケジューラの指定ミス） */
  | { kind: 'not_current_month'; currentMonth: YearMonth }
  /** 世帯にメンバーが 1 人も登録されていない（催促する相手が居ない） */
  | { kind: 'no_members' }
  /** 共通トークルームが未参加で配信先を決められない */
  | { kind: 'target_unresolved' }
  /** 既に停止済み（この月のリマインダーは終了している） */
  | { kind: 'already_stopped' }
  /** 停止条件が成立したので停止を記録した */
  | { kind: 'stopped'; judgment: Extract<ReminderContinuationJudgment, { kind: 'stop' }> }
  /** 同じ JST 暦日に配信済み */
  | { kind: 'already_sent_today' }
  | { kind: 'sent' }
  /** LINE 送信に失敗した（単発失敗はログのみでスキップする＝論点23。翌日の実行で再送される） */
  | { kind: 'send_failed' }

export interface CsvImportReminderDeps {
  notificationDeliveryService: NotificationDeliveryService
  sharedTalkRoomRepository: SharedTalkRoomRepository
  appUserRepository: AppUserRepository
  csvImportStatusQuery: CsvImportStatusQuery
  eventBus: EventBus
  deepLinks: DeepLinkBuilder
  now?: (() => Date) | undefined
}

export interface CsvImportReminderRunner {
  run(params: { targetMonth: YearMonth; at?: Date }): Promise<CsvImportReminderOutcome>
}

/**
 * 対象月を指定しないで起動したときの既定（起動時刻から JST 暦の当月）。
 *
 * 「5 日以降かつ当月」の判定はこのモジュール（`judgeReminderWindow`）が持つため、既定の
 * 導出もここに置く。呼出し元（#416 のスケジューラ）が独自に月を導出すると、月初・月末の
 * 境界で判定側と食い違って毎回 `not_current_month` になる。
 */
export function defaultReminderTargetMonth(at: Date): YearMonth {
  return jstYearMonthOf(at)
}

/**
 * 停止の冪等性キー（対象月 × 停止理由ごとに 1 回だけ記録する）。
 *
 * 理由を含めるのは、月の前半に通知無効化で停止したあと再有効化して配信が再開し、
 * 後半に本来の「CSV 取込完了」で停止したときに、実態と異なる停止理由だけが
 * 監査ログに凍結されるのを避けるため。同じ理由での二重発火は従来どおり防げる。
 */
function stopIdempotencyKey(
  talkRoomId: TalkRoomId,
  targetMonth: YearMonth,
  stopReason: ReminderStopReason,
): string {
  return `csv_import_reminder:stop:${talkRoomId}:${targetMonth}:${stopReason}`
}

/** 停止理由 → 配信ログのスキップ理由（08g §1 は両者を別語彙として持つ） */
const SKIP_REASON_BY_STOP_REASON: Record<ReminderStopReason, DeliverySkipReason> = {
  csv_import_completed: 'reminder_stop_condition_met',
  notification_disabled: 'notification_disabled',
}

/** 配信の冪等性キー（対象月 × JST 暦日で 1 日 1 通） */
function sendIdempotencyKey(talkRoomId: TalkRoomId, targetMonth: YearMonth, at: Date): string {
  return `csv_import_reminder:${talkRoomId}:${targetMonth}:${jstDateKey(at)}`
}

export function createCsvImportReminderRunner(
  deps: CsvImportReminderDeps,
): CsvImportReminderRunner {
  const now = deps.now ?? ((): Date => new Date())

  /** 夫婦それぞれについて、対象月のリマインダー継続可否を判定する（未登録は含めない） */
  async function judgeForMembers(
    targetMonth: YearMonth,
    at: Date,
  ): Promise<ReminderContinuationJudgment[]> {
    const users = (
      await Promise.all([
        deps.appUserRepository.findByRole('honey'),
        deps.appUserRepository.findByRole('darling'),
      ])
    ).filter(user => user !== null)

    return Promise.all(
      users.map(async user => {
        const completion = await deps.csvImportStatusQuery.fetchCompletion(
          user.common.userId,
          targetMonth,
        )
        return judgeReminderContinuation(
          {
            csvImportCompleted: completion !== null,
            notificationEnabled: isNotificationActivated(user),
          },
          at,
        )
      }),
    )
  }

  return {
    async run(params): Promise<CsvImportReminderOutcome> {
      // 呼出し元はスケジューラのイベント payload（外部入力）になるため、型だけに頼らず検証する
      const targetMonth = YearMonthSchema.parse(params.targetMonth)
      const at = params.at ?? now()

      const window = judgeReminderWindow(targetMonth, at)
      if (window.kind !== 'open') {
        console.warn(
          `[notification] CSV 取込リマインダーは配信期間外のためスキップする（${targetMonth}: ${window.kind}）`,
        )
        return window.kind === 'before_start_day'
          ? { kind: 'before_start_day', dayOfMonth: window.dayOfMonth }
          : { kind: 'not_current_month', currentMonth: window.currentMonth }
      }

      const talkRoomId = joinedTalkRoomIdOf(await deps.sharedTalkRoomRepository.find())
      if (talkRoomId === undefined) {
        // 配信先が未確定では配信メッセージ自体を組み立てられない（配信先は必須属性）。
        // 記録を残せないため警告のみとし、共通トークルーム参加後の実行で回復する
        console.warn(
          `[notification] 共通トークルーム未参加のため CSV 取込リマインダーを送れない: ${targetMonth}`,
        )
        return { kind: 'target_unresolved' }
      }

      const judgment = combineReminderJudgments(await judgeForMembers(targetMonth, at))
      if (judgment === undefined) {
        // 08g の停止理由 2 値はどちらも実態に合わないため、停止として記録もイベント発行もしない
        console.warn(
          `[notification] 世帯にメンバーが未登録のため CSV 取込リマインダーを送れない: ${targetMonth}`,
        )
        return { kind: 'no_members' }
      }

      const target = DeliveryTargetSchema.parse({ kind: 'shared_talk_room', talkRoomId })
      const content = buildCsvImportReminderContent(targetMonth, deps.deepLinks)

      if (judgment.kind === 'stop') {
        const outcome = await deps.notificationDeliveryService.skip({
          target,
          content,
          purpose: 'csv_import_reminder',
          idempotencyKey: stopIdempotencyKey(talkRoomId, targetMonth, judgment.stopReason),
          skipReason: SKIP_REASON_BY_STOP_REASON[judgment.stopReason],
        })
        if (outcome.kind === 'already_delivered') return { kind: 'already_stopped' }

        await deps.eventBus.publish(
          ReminderStoppedSchema.parse({
            ...domainEventBase(at),
            type: 'ReminderStopped',
            talkRoomId,
            targetMonth,
            stopReason: judgment.stopReason,
          }),
        )
        return { kind: 'stopped', judgment }
      }

      const outcome = await deps.notificationDeliveryService.deliver({
        target,
        content,
        purpose: 'csv_import_reminder',
        idempotencyKey: sendIdempotencyKey(talkRoomId, targetMonth, at),
      })
      if (outcome.kind === 'already_delivered') return { kind: 'already_sent_today' }
      if (outcome.kind === 'failed') {
        console.error(
          `[notification] CSV 取込リマインダーの送信に失敗した（翌日の実行で再送される）: ${targetMonth}`,
        )
        return { kind: 'send_failed' }
      }

      await deps.eventBus.publish(
        ReminderSentSchema.parse({
          ...domainEventBase(at),
          type: 'ReminderSent',
          deliveryMessageId: outcome.message.common.deliveryMessageId,
          talkRoomId,
          targetMonth,
        }),
      )
      return { kind: 'sent' }
    },
  }
}

/**
 * 合成済みの依存（AppDeps）からリマインダー実行器を組み立てる。
 *
 * バッチのエントリポイント（#416）はこの関数だけを呼べばよく、
 * 通知配信サービスや Deep Link 生成器の組み立て方を知らずに済む。
 */
export function createCsvImportReminderRunnerFromDeps(deps: AppDeps): CsvImportReminderRunner {
  return createCsvImportReminderRunner({
    notificationDeliveryService: createNotificationDeliveryService(deps),
    sharedTalkRoomRepository: deps.sharedTalkRoomRepository,
    appUserRepository: deps.appUserRepository,
    csvImportStatusQuery: deps.csvImportStatusQuery,
    eventBus: deps.eventBus,
    deepLinks: createDeepLinkBuilder(deps.webBaseUrl),
  })
}
