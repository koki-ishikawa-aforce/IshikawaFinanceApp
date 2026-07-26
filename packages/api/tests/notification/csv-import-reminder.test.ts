import { describe, it, expect, beforeEach } from 'vitest'
import type {
  AppUser,
  CsvImportCompletionView,
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
  jstCalendarParts,
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

function stubLineGateway(result: LinePushResult): LineMessagingGateway & { calls: number } {
  const gateway = {
    calls: 0,
    sendPush() {
      gateway.calls += 1
      return Promise.resolve({ sentPayloadJson: '{"stub":true}', result })
    },
  }
  return gateway
}

interface Harness {
  runner: CsvImportReminderRunner
  events: DomainEvent[]
  lineGateway: LineMessagingGateway & { calls: number }
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

describe('jstCalendarParts', () => {
  it('UTC の深夜は JST では翌日の午前 9 時として扱われる', () => {
    // UTC 2026-07-04T20:00 = JST 2026-07-05T05:00（= リマインダー開始日）
    expect(jstCalendarParts(new Date('2026-07-04T20:00:00Z'))).toEqual({
      year: 2026,
      month: 7,
      day: 5,
    })
  })

  it('UTC 基準ではまだ 5 日でも JST で 5 日なら 5 日と判定する', () => {
    expect(jstCalendarParts(new Date('2026-07-05T00:00:00Z')).day).toBe(5)
  })
})

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

    it('配信ログに送信 payload が凍結される（OQ-34）', async () => {
      await harness.runner.run({ targetMonth: month, at: day10 })
      const log = await harness.logRepository.findByIdempotencyKey(
        `csv_import_reminder:${TALK_ROOM_ID}:${month}:2026-07-10`,
      )
      expect(log?.resultStatus.kind).toBe('success')
      expect(log?.timingKind).toBe('reminder')
      expect(log?.sentPayloadJson).toBe('{"stub":true}')
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
      const log = await harness.logRepository.findByIdempotencyKey(
        `csv_import_reminder:stop:${TALK_ROOM_ID}:${month}`,
      )
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

    it('通知機能が無効なら notification_disabled を理由に停止する', async () => {
      const disabled = await buildHarness({
        users: [appUser('honey', 'user-honey', false), appUser('darling', 'user-darling', false)],
      })
      const outcome = await disabled.runner.run({ targetMonth: month, at: day10 })
      expect(outcome.kind).toBe('stopped')
      expect(disabled.events[0]).toMatchObject({
        type: 'ReminderStopped',
        stopReason: 'notification_disabled',
      })
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
      const log = await failing.logRepository.findByIdempotencyKey(
        `csv_import_reminder:${TALK_ROOM_ID}:${month}:2026-07-10`,
      )
      expect(log?.resultStatus.kind).toBe('failure')
    })
  })
})
