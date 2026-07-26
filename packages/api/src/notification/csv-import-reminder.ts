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
 * 日付は JST で判定する（利用者の「5 日」は JST の暦日であり、UTC で判定すると
 * 毎月 9 時間ぶんだけ前倒しで発火する）。
 */
import type {
  AppUserRepository,
  CsvImportStatusQuery,
  EventBus,
  ReminderContinuationJudgment,
  SharedTalkRoomRepository,
  TalkRoomId,
  YearMonth,
} from '@warimaru/domain'
import {
  DeliveryTargetSchema,
  REMINDER_START_DAY_OF_MONTH,
  ReminderSentSchema,
  ReminderStoppedSchema,
  combineReminderJudgments,
  joinedTalkRoomIdOf,
  judgeReminderContinuation,
  lineOperationSettingsOf,
} from '@warimaru/domain'
import type { AppDeps } from '../composition-root.js'
import type { NotificationDeliveryService } from './delivery-service.js'
import { createNotificationDeliveryService } from './delivery-service.js'
import type { DeepLinkBuilder } from './deep-links.js'
import { createDeepLinkBuilder } from './deep-links.js'
import { buildCsvImportReminderContent } from './message-content.js'
import { domainEventBase } from '../event-handlers/event-base.js'

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

/** JST の暦日（年・月・日）。Date は UTC 基準のため +9h してから UTC 部品を読む */
export function jstCalendarParts(at: Date): { year: number; month: number; day: number } {
  const jst = new Date(at.getTime() + JST_OFFSET_MS)
  return { year: jst.getUTCFullYear(), month: jst.getUTCMonth() + 1, day: jst.getUTCDate() }
}

/** JST 暦日のキー（YYYY-MM-DD）。1 日 1 通の冪等性キーに使う */
function jstDateKey(at: Date): string {
  const { year, month, day } = jstCalendarParts(at)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export type CsvImportReminderOutcome =
  /** 当月 5 日より前のため対象外（08g §2 の事前条件） */
  | { kind: 'before_start_day'; dayOfMonth: number }
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

/** 停止の冪等性キー（対象月に 1 回だけ停止を記録する） */
function stopIdempotencyKey(talkRoomId: TalkRoomId, targetMonth: YearMonth): string {
  return `csv_import_reminder:stop:${talkRoomId}:${targetMonth}`
}

/** 配信の冪等性キー（対象月 × JST 暦日で 1 日 1 通） */
function sendIdempotencyKey(talkRoomId: TalkRoomId, targetMonth: YearMonth, at: Date): string {
  return `csv_import_reminder:${talkRoomId}:${targetMonth}:${jstDateKey(at)}`
}

export function createCsvImportReminderRunner(
  deps: CsvImportReminderDeps,
): CsvImportReminderRunner {
  const now = deps.now ?? ((): Date => new Date())

  /** 夫婦それぞれについて、対象月のリマインダー継続可否を判定する */
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
            notificationEnabled:
              lineOperationSettingsOf(user).notificationActivation.kind === 'activated',
          },
          at,
        )
      }),
    )
  }

  return {
    async run({ targetMonth, at = now() }): Promise<CsvImportReminderOutcome> {
      const { day } = jstCalendarParts(at)
      if (day < REMINDER_START_DAY_OF_MONTH) {
        return { kind: 'before_start_day', dayOfMonth: day }
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

      const target = DeliveryTargetSchema.parse({ kind: 'shared_talk_room', talkRoomId })
      const content = buildCsvImportReminderContent(targetMonth, deps.deepLinks)
      const judgment = combineReminderJudgments(await judgeForMembers(targetMonth, at), at)

      if (judgment.kind === 'stop') {
        const outcome = await deps.notificationDeliveryService.skip({
          target,
          content,
          purpose: 'csv_import_reminder',
          idempotencyKey: stopIdempotencyKey(talkRoomId, targetMonth),
          skipReason: 'reminder_stop_condition_met',
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
      if (outcome.kind === 'failed') return { kind: 'send_failed' }

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
