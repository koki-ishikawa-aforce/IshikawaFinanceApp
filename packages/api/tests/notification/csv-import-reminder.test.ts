import { describe, it, expect, beforeEach } from 'vitest'
import type {
  AppUser,
  CsvImportCompletionView,
  DeliveryContent,
  DomainEvent,
  LineMessagingGateway,
  LinePushResult,
  UserId,
  UserRole,
  YearMonth,
} from '@warimaru/domain'
import {
  AppUserSchema,
  InMemoryEventBus,
  LineMessageIdSchema,
  YearMonthSchema,
  recordSharedTalkRoomJoined,
  NOT_JOINED_SHARED_TALK_ROOM,
  TalkRoomIdSchema,
} from '@warimaru/domain'
import { createNotificationDeliveryService } from '../../src/notification/delivery-service.js'
import { createDeepLinkBuilder } from '../../src/notification/deep-links.js'
import {
  createCsvImportReminderRunner,
  type CsvImportReminderRunner,
} from '../../src/notification/csv-import-reminder.js'
import {
  createMockAppUserRepository,
  createMockConsecutiveFailureCounterRepository,
  createMockDeliveryMessageRepository,
  createMockFailsafeEmailRepository,
  createMockLineDeliveryLogRepository,
  createMockSharedTalkRoomRepository,
} from '../../src/mock-repositories.js'
import { createMockFailsafeEmailGateway } from '../../src/notification/mock.js'

const TALK_ROOM_ID = TalkRoomIdSchema.parse('room_household_001')
const month: YearMonth = YearMonthSchema.parse('2026-07')

/** JST 2026-07-10 09:00（= UTC 00:00）。当月 5 日以降でリマインダー対象内 */
const day10 = new Date('2026-07-10T00:00:00Z')
/** JST 2026-07-11 */
const day11 = new Date('2026-07-11T00:00:00Z')

function appUser(role: UserRole, userId: string, notificationActivated = true): AppUser {
  return AppUserSchema.parse({
    kind: 'phase1_completed',
    common: {
      userId,
      role,
      firstRegisteredAt: new Date('2026-01-01T00:00:00Z'),
      lineOperationSettings: {
        friendAdd: { kind: 'added', followWebhookReceivedAt: new Date('2026-01-01T00:00:00Z') },
        notificationActivation: notificationActivated
          ? { kind: 'activated', activatedAt: new Date('2026-01-02T00:00:00Z') }
          : { kind: 'not_activated' },
      },
    },
  })
}

const pushSuccess: LinePushResult = {
  kind: 'success',
  lineMessageId: LineMessageIdSchema.parse('line-msg-1'),
}
const pushFailure: LinePushResult = {
  kind: 'failure',
  failureReason: 'line_api_failure',
  detail: 'stub failure',
}

/** 送信本文を記録するスタブ（本文が検証されないと対象月の取り違えを検出できない） */
function stubLineGateway(
  result: LinePushResult,
): LineMessagingGateway & { calls: number; sentTexts: string[] } {
  const gateway = {
    calls: 0,
    sentTexts: [] as string[],
    sendPush(_target: unknown, content: DeliveryContent) {
      gateway.calls += 1
      gateway.sentTexts.push(
        content.kind === 'plain_text'
          ? `${content.textBody}\n${content.linkUrl ?? ''}`
          : content.flexPayloadJson,
      )
      return Promise.resolve({ sentPayloadJson: JSON.stringify(content), result })
    },
  }
  return gateway
}

interface Harness {
  runner: CsvImportReminderRunner
  events: DomainEvent[]
  lineGateway: LineMessagingGateway & { calls: number; sentTexts: string[] }
  logRepository: ReturnType<typeof createMockLineDeliveryLogRepository>
}

async function buildHarness(options: {
  /** 対象月の CSV 取込を完了済みにするユーザーID */
  completedUserIds?: string[]
  joined?: boolean
  users?: AppUser[]
  pushResult?: LinePushResult
}): Promise<Harness> {
  const eventBus = new InMemoryEventBus()
  const events: DomainEvent[] = []
  for (const type of ['ReminderSent', 'ReminderStopped']) {
    eventBus.subscribe(type, event => {
      events.push(event)
      return Promise.resolve()
    })
  }

  const appUserRepository = createMockAppUserRepository()
  for (const user of options.users ?? [
    appUser('honey', 'user-honey'),
    appUser('darling', 'user-darling'),
  ]) {
    await appUserRepository.save(user)
  }

  const sharedTalkRoomRepository = createMockSharedTalkRoomRepository()
  if (options.joined ?? true) {
    await sharedTalkRoomRepository.save(
      recordSharedTalkRoomJoined(NOT_JOINED_SHARED_TALK_ROOM, TALK_ROOM_ID, day10),
    )
  }

  const completed = new Set(options.completedUserIds ?? [])
  const logRepository = createMockLineDeliveryLogRepository()
  const lineGateway = stubLineGateway(options.pushResult ?? pushSuccess)

  const runner = createCsvImportReminderRunner({
    notificationDeliveryService: createNotificationDeliveryService({
      deliveryMessageRepository: createMockDeliveryMessageRepository(),
      lineDeliveryLogRepository: logRepository,
      consecutiveFailureCounterRepository: createMockConsecutiveFailureCounterRepository(),
      failsafeEmailRepository: createMockFailsafeEmailRepository(),
      lineMessagingGateway: lineGateway,
      failsafeEmailGateway: createMockFailsafeEmailGateway(),
      eventBus,
      failsafeEmailRecipients: [],
    }),
    sharedTalkRoomRepository,
    appUserRepository,
    csvImportStatusQuery: {
      fetchCompletion(userId: UserId, targetMonth: YearMonth) {
        if (targetMonth !== month || !completed.has(userId)) return Promise.resolve(null)
        return Promise.resolve({
          userId,
          targetMonth,
          importJobId: 'job-001',
          completedAt: new Date('2026-07-09T00:00:00Z'),
        } as CsvImportCompletionView)
      },
    },
    eventBus,
    deepLinks: createDeepLinkBuilder('https://liff.example/app'),
  })

  return { runner, events, lineGateway, logRepository }
}

describe('CSV 取込リマインダー', () => {
  let harness: Harness

  describe('当月 5 日より前', () => {
    beforeEach(async () => {
      harness = await buildHarness({})
    })

    it('配信せず対象外として返す（08g §2 の事前条件）', async () => {
      // UTC 2026-07-04T10:00 = JST 2026-07-04T19:00（4 日）
      const outcome = await harness.runner.run({
        targetMonth: month,
        at: new Date('2026-07-04T10:00:00Z'),
      })
      expect(outcome).toEqual({ kind: 'before_start_day', dayOfMonth: 4 })
      expect(harness.lineGateway.calls).toBe(0)
      expect(harness.events).toHaveLength(0)
    })

    it('JST で 5 日になった瞬間から配信対象になる', async () => {
      const outcome = await harness.runner.run({
        targetMonth: month,
        at: new Date('2026-07-04T15:00:00Z'), // = JST 2026-07-05T00:00
      })
      expect(outcome.kind).toBe('sent')
    })
  })

  describe('CSV 未取込（催促が必要）', () => {
    beforeEach(async () => {
      harness = await buildHarness({})
    })

    it('共通トークルームへ配信し ReminderSent を発行する', async () => {
      const outcome = await harness.runner.run({ targetMonth: month, at: day10 })
      expect(outcome.kind).toBe('sent')
      expect(harness.lineGateway.calls).toBe(1)
      expect(harness.events).toHaveLength(1)
      expect(harness.events[0]).toMatchObject({
        type: 'ReminderSent',
        talkRoomId: TALK_ROOM_ID,
        targetMonth: month,
      })
    })

    it('送信本文が対象月の催促になっている（月の取り違えを検出する）', async () => {
      await harness.runner.run({ targetMonth: month, at: day10 })
      const sent = harness.lineGateway.sentTexts[0] ?? ''
      expect(sent).toContain('2026年7月')
      // アップロード先（アプリ）と明細のダウンロード元（カード）の両方に対象月が伝わる
      expect(sent).toContain('https://liff.example/app/imports?month=2026-07')
      expect(sent).toContain('https://www.smbc-card.com/memx/web_meisai/top/index.html?p01=202607')
      expect(sent).toContain('https://direct3.smbc.co.jp/sp/web/')
    })

    it('配信ログに送信 payload が凍結される（OQ-34）', async () => {
      await harness.runner.run({ targetMonth: month, at: day10 })
      const log = (
        await harness.logRepository.findAllByIdempotencyKey(
          `csv_import_reminder:${TALK_ROOM_ID}:${month}:2026-07-10`,
        )
      ).at(-1)
      expect(log?.resultStatus.kind).toBe('success')
      expect(log?.timingKind).toBe('reminder')
      expect(log?.sentPayloadJson).toContain('2026年7月')
    })

    it('同じ JST 暦日に再実行しても二重配信しない（冪等）', async () => {
      await harness.runner.run({ targetMonth: month, at: day10 })
      const second = await harness.runner.run({
        targetMonth: month,
        at: new Date('2026-07-10T14:00:00Z'), // 同じ JST 暦日
      })
      expect(second).toEqual({ kind: 'already_sent_today' })
      expect(harness.lineGateway.calls).toBe(1)
      expect(harness.events).toHaveLength(1)
    })

    it('翌日は改めて配信される（取込が終わるまで日次で催促する）', async () => {
      await harness.runner.run({ targetMonth: month, at: day10 })
      const next = await harness.runner.run({ targetMonth: month, at: day11 })
      expect(next.kind).toBe('sent')
      expect(harness.lineGateway.calls).toBe(2)
      expect(harness.events).toHaveLength(2)
    })

    it('片方だけ取込済みでも、もう片方が未取込なら配信を続ける', async () => {
      const partial = await buildHarness({ completedUserIds: ['user-honey'] })
      const outcome = await partial.runner.run({ targetMonth: month, at: day10 })
      expect(outcome.kind).toBe('sent')
      expect(partial.events[0]).toMatchObject({ type: 'ReminderSent' })
    })
  })

  describe('CSV 取込完了（停止）', () => {
    beforeEach(async () => {
      harness = await buildHarness({ completedUserIds: ['user-honey', 'user-darling'] })
    })

    it('配信せず ReminderStopped を発行する', async () => {
      const outcome = await harness.runner.run({ targetMonth: month, at: day10 })
      expect(outcome.kind).toBe('stopped')
      expect(harness.lineGateway.calls).toBe(0)
      expect(harness.events).toHaveLength(1)
      expect(harness.events[0]).toMatchObject({
        type: 'ReminderStopped',
        talkRoomId: TALK_ROOM_ID,
        targetMonth: month,
        stopReason: 'csv_import_completed',
      })
    })

    it('停止はスキップとして配信ログに記録される', async () => {
      await harness.runner.run({ targetMonth: month, at: day10 })
      const log = (
        await harness.logRepository.findAllByIdempotencyKey(
          `csv_import_reminder:stop:${TALK_ROOM_ID}:${month}:csv_import_completed`,
        )
      ).at(-1)
      expect(log?.resultStatus).toMatchObject({
        kind: 'skipped',
        skipReason: 'reminder_stop_condition_met',
      })
    })

    it('翌日以降に再実行しても ReminderStopped は再発行されない（月に 1 回）', async () => {
      await harness.runner.run({ targetMonth: month, at: day10 })
      const next = await harness.runner.run({ targetMonth: month, at: day11 })
      expect(next).toEqual({ kind: 'already_stopped' })
      expect(harness.events).toHaveLength(1)
      expect(harness.lineGateway.calls).toBe(0)
    })

    it('通知機能が無効なら notification_disabled を理由に停止し、配信ログにも同じ理由が残る', async () => {
      const disabled = await buildHarness({
        users: [appUser('honey', 'user-honey', false), appUser('darling', 'user-darling', false)],
      })
      const outcome = await disabled.runner.run({ targetMonth: month, at: day10 })
      expect(outcome.kind).toBe('stopped')
      expect(disabled.events[0]).toMatchObject({
        type: 'ReminderStopped',
        stopReason: 'notification_disabled',
      })
      // 停止理由 → スキップ理由の写像（08g §1 は両者を別語彙として持つ）
      const log = (
        await disabled.logRepository.findAllByIdempotencyKey(
          `csv_import_reminder:stop:${TALK_ROOM_ID}:${month}:notification_disabled`,
        )
      ).at(-1)
      expect(log?.resultStatus).toMatchObject({
        kind: 'skipped',
        skipReason: 'notification_disabled',
      })
    })

    it('停止条件が解けたら配信を再開する（取込のやり直し・通知の再有効化）', async () => {
      await harness.runner.run({ targetMonth: month, at: day10 })
      // 取込が取り消された状態を作る: 完了していない世帯として組み直す
      const resumed = await buildHarness({})
      const outcome = await resumed.runner.run({ targetMonth: month, at: day11 })
      expect(outcome.kind).toBe('sent')
    })

    it('別の理由で停止が成立したら、その理由でも 1 度だけ ReminderStopped を発行する', async () => {
      const disabled = await buildHarness({
        users: [appUser('honey', 'user-honey', false), appUser('darling', 'user-darling', false)],
        completedUserIds: ['user-honey', 'user-darling'],
      })
      // 取込完了が優先されるので csv_import_completed で停止する
      await disabled.runner.run({ targetMonth: month, at: day10 })
      expect(disabled.events).toHaveLength(1)
      expect(disabled.events[0]).toMatchObject({ stopReason: 'csv_import_completed' })
    })
  })

  describe('対象月・世帯の前提が満たされない', () => {
    it('対象月が当月でなければ配信しない（スケジューラの指定ミス）', async () => {
      const h = await buildHarness({})
      const outcome = await h.runner.run({
        targetMonth: month,
        at: new Date('2026-08-10T00:00:00Z'),
      })
      expect(outcome).toEqual({ kind: 'not_current_month', currentMonth: '2026-08' })
      expect(h.lineGateway.calls).toBe(0)
      expect(h.events).toHaveLength(0)
    })

    it('メンバーが 1 人も登録されていなければ、停止も記録せずイベントも出さない', async () => {
      const h = await buildHarness({ users: [] })
      const outcome = await h.runner.run({ targetMonth: month, at: day10 })
      expect(outcome).toEqual({ kind: 'no_members' })
      expect(h.lineGateway.calls).toBe(0)
      // 08g の停止理由 2 値はどちらも実態に合わないため ReminderStopped を出さない
      expect(h.events).toHaveLength(0)
    })

    it('不正な対象月は受け付けない（スケジューラ payload は外部入力）', async () => {
      const h = await buildHarness({})
      await expect(
        h.runner.run({ targetMonth: '2026-13' as YearMonth, at: day10 }),
      ).rejects.toThrow()
      expect(h.lineGateway.calls).toBe(0)
    })
  })

  describe('配信先が未確定', () => {
    it('共通トークルーム未参加なら配信も停止記録もしない（参加後の実行で回復する）', async () => {
      const notJoined = await buildHarness({ joined: false })
      const outcome = await notJoined.runner.run({ targetMonth: month, at: day10 })
      expect(outcome).toEqual({ kind: 'target_unresolved' })
      expect(notJoined.lineGateway.calls).toBe(0)
      expect(notJoined.events).toHaveLength(0)
    })
  })

  describe('LINE 送信失敗', () => {
    it('単発失敗はログのみで握りつぶさず結果に現れる（論点23）', async () => {
      const failing = await buildHarness({ pushResult: pushFailure })
      const outcome = await failing.runner.run({ targetMonth: month, at: day10 })
      expect(outcome).toEqual({ kind: 'send_failed' })
      // 送信できていないので ReminderSent は発行しない
      expect(failing.events).toHaveLength(0)
      const log = (
        await failing.logRepository.findAllByIdempotencyKey(
          `csv_import_reminder:${TALK_ROOM_ID}:${month}:2026-07-10`,
        )
      ).at(-1)
      expect(log?.resultStatus.kind).toBe('failure')
    })
  })
})
