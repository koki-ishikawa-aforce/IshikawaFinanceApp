import { describe, it, expect } from 'vitest'
import type {
  AppUser,
  CsvImportCompletionView,
  DomainEvent,
  LineMessagingGateway,
  LinePushResult,
  MonthlyReport,
  UserId,
  UserRole,
  YearMonth,
} from '@warimaru/domain'
import {
  AppUserSchema,
  CategoryMasterSchema,
  InMemoryEventBus,
  LineMessageIdSchema,
  MonthlyReportCsvConfirmedSchema,
  MonthlyReportSchema,
  NOT_JOINED_SHARED_TALK_ROOM,
  TalkRoomIdSchema,
  YearMonthSchema,
  recordSharedTalkRoomJoined,
} from '@warimaru/domain'
import { createDeepLinkBuilder } from '../../src/notification/deep-links.js'
import { createNotificationDeliveryService } from '../../src/notification/delivery-service.js'
import { createMockFailsafeEmailGateway } from '../../src/notification/mock.js'
import { registerMonthlyReportDeliveryEventHandlers } from '../../src/event-handlers/monthly-report-delivery.js'
import { domainEventBase } from '../../src/event-handlers/event-base.js'
import {
  createMockAppUserRepository,
  createMockCategoryMasterRepository,
  createMockConsecutiveFailureCounterRepository,
  createMockDeliveryMessageRepository,
  createMockFailsafeEmailRepository,
  createMockLineDeliveryLogRepository,
  createMockMonthlyReportRepository,
  createMockSharedTalkRoomRepository,
} from '../../src/mock-repositories.js'

const ulid = (suffix: string): string => `01HZ${suffix}`.padEnd(26, '0')
const REPORT_ID = ulid('RPRT')
const CATEGORY_FOOD = ulid('CATF')
const TALK_ROOM_ID = TalkRoomIdSchema.parse('room_household_001')
const month: YearMonth = YearMonthSchema.parse('2026-07')
const at = new Date('2026-08-01T00:00:00Z')

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

function report(): MonthlyReport {
  return MonthlyReportSchema.parse({
    kind: 'csv_confirmed',
    common: {
      monthlyReportId: REPORT_ID,
      targetYearMonth: month,
      householdCategoryTotals: [{ categoryId: CATEGORY_FOOD, total: 82000 }],
      personalTotalHoney: 31000,
      personalTotalDarling: 27500,
      businessExpenseTotalHoney: 12000,
      businessExpenseTotalDarling: 4500,
      nisaContributionAccumulated: 600000,
      balanceTrend: {
        smbcBalanceTrend: [],
        otherSavingsBalanceTrend: [],
        nisaContributionTrend: [],
        cardUnpaidTrend: [],
      },
    },
    csvConfirmedAt: at,
    causingTransactionIds: [],
  })
}

const pushSuccess: LinePushResult = {
  kind: 'success',
  lineMessageId: LineMessageIdSchema.parse('line-msg-1'),
}

/** 送信先と payload を記録するスタブ LINE ゲートウェイ */
function recordingGateway(
  result: LinePushResult = pushSuccess,
): LineMessagingGateway & { sends: { to: string; payload: string }[] } {
  const gateway = {
    sends: [] as { to: string; payload: string }[],
    sendPush(target: Parameters<LineMessagingGateway['sendPush']>[0], content: unknown) {
      const to = target.kind === 'shared_talk_room' ? target.talkRoomId : target.userId
      const payload = JSON.stringify({ to, content })
      gateway.sends.push({ to, payload })
      return Promise.resolve({ sentPayloadJson: payload, result })
    },
  }
  return gateway
}

async function buildHarness(options: {
  completedUserIds?: string[]
  joined?: boolean
  savedReport?: MonthlyReport | null
  pushResult?: LinePushResult
  users?: AppUser[]
  /** 世帯サマリ配信の途中で例外を起こす（配信先の解決を失敗させる） */
  failHouseholdSummary?: boolean
}) {
  const eventBus = new InMemoryEventBus()
  const events: DomainEvent[] = []
  for (const type of [
    'MonthlyReportHouseholdSummaryDelivered',
    'MonthlyReportPersonalSummaryDelivered',
  ]) {
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
      recordSharedTalkRoomJoined(NOT_JOINED_SHARED_TALK_ROOM, TALK_ROOM_ID, at),
    )
  }
  if (options.failHouseholdSummary === true) {
    sharedTalkRoomRepository.find = () => Promise.reject(new Error('injected talk room failure'))
  }

  const monthlyReportRepository = createMockMonthlyReportRepository()
  const saved = options.savedReport === undefined ? report() : options.savedReport
  if (saved !== null) await monthlyReportRepository.save(saved)

  const categoryMasterRepository = createMockCategoryMasterRepository()
  await categoryMasterRepository.save(
    CategoryMasterSchema.parse({
      kind: 'default',
      categoryId: CATEGORY_FOOD,
      name: '食費',
      scope: { kind: 'household_shared' },
      defaultKind: 'food',
    }),
  )

  const completed = new Set(options.completedUserIds ?? ['user-honey', 'user-darling'])
  const lineGateway = recordingGateway(options.pushResult)
  const logRepository = createMockLineDeliveryLogRepository()

  registerMonthlyReportDeliveryEventHandlers(eventBus, {
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
    monthlyReportRepository,
    appUserRepository,
    sharedTalkRoomRepository,
    csvImportStatusQuery: {
      fetchCompletion(userId: UserId, targetMonth: YearMonth) {
        if (targetMonth !== month || !completed.has(userId)) return Promise.resolve(null)
        return Promise.resolve({
          userId,
          targetMonth,
          importJobId: ulid('JOB1'),
          completedAt: at,
        } as CsvImportCompletionView)
      },
    },
    categoryMasterRepository,
    deepLinks: createDeepLinkBuilder('https://liff.example/app'),
  })

  const publishConfirmed = (): Promise<void> =>
    eventBus.publish(
      MonthlyReportCsvConfirmedSchema.parse({
        ...domainEventBase(at),
        type: 'MonthlyReportCsvConfirmed',
        monthlyReportId: REPORT_ID,
        csvConfirmedAt: at,
      }),
    )

  return { events, lineGateway, logRepository, publishConfirmed }
}

describe('月次レポートCSV確定 → サマリ配信', () => {
  it('夫婦両方が取込済みなら世帯サマリを共通トークルームへ配信する', async () => {
    const h = await buildHarness({})
    await h.publishConfirmed()

    const toTalkRoom = h.lineGateway.sends.filter(s => s.to === TALK_ROOM_ID)
    expect(toTalkRoom).toHaveLength(1)
    expect(toTalkRoom[0]?.payload).toContain('82,000円')
    expect(toTalkRoom[0]?.payload).toContain('食費')
    expect(h.events.filter(e => e.type === 'MonthlyReportHouseholdSummaryDelivered')).toHaveLength(
      1,
    )
  })

  it('個人サマリを夫婦それぞれの DM へ配信する', async () => {
    const h = await buildHarness({})
    await h.publishConfirmed()

    expect(h.lineGateway.sends.map(s => s.to)).toEqual([TALK_ROOM_ID, 'user-honey', 'user-darling'])
    expect(h.events.filter(e => e.type === 'MonthlyReportPersonalSummaryDelivered')).toHaveLength(2)
  })

  it('個人 DM には宛先本人の値だけが載る（プライバシー3段階ルール）', async () => {
    const h = await buildHarness({})
    await h.publishConfirmed()

    const honey = h.lineGateway.sends.find(s => s.to === 'user-honey')
    expect(honey?.payload).toContain('31,000円')
    expect(honey?.payload).toContain('12,000円')
    expect(honey?.payload).not.toContain('27,500円')
    expect(honey?.payload).not.toContain('4,500円')

    const darling = h.lineGateway.sends.find(s => s.to === 'user-darling')
    expect(darling?.payload).toContain('27,500円')
    expect(darling?.payload).not.toContain('31,000円')
  })

  it('共通トークルームには個人費用・経費が載らない', async () => {
    const h = await buildHarness({})
    await h.publishConfirmed()

    const toTalkRoom = h.lineGateway.sends.find(s => s.to === TALK_ROOM_ID)
    expect(toTalkRoom?.payload).not.toContain('31,000円')
    expect(toTalkRoom?.payload).not.toContain('12,000円')
    expect(toTalkRoom?.payload).not.toContain('27,500円')
    expect(toTalkRoom?.payload).not.toContain('4,500円')
  })

  it('片方が未取込なら 1 通も配信しない', async () => {
    const h = await buildHarness({ completedUserIds: ['user-honey'] })
    await h.publishConfirmed()

    expect(h.lineGateway.sends).toHaveLength(0)
    expect(h.events).toHaveLength(0)
  })

  it('同一レポートへの再確定では二重配信しない（冪等）', async () => {
    const h = await buildHarness({})
    await h.publishConfirmed()
    await h.publishConfirmed()

    expect(h.lineGateway.sends).toHaveLength(3)
    expect(h.events).toHaveLength(3)
  })

  it('配信ログに配信時点の payload が凍結される（後の遡及修正の影響を受けない、OQ-34）', async () => {
    const h = await buildHarness({})
    await h.publishConfirmed()

    const householdLog = (
      await h.logRepository.findAllByIdempotencyKey(`monthly_report_household_summary:${REPORT_ID}`)
    ).at(-1)
    expect(householdLog?.resultStatus.kind).toBe('success')
    expect(householdLog?.timingKind).toBe('csv_confirmation')
    expect(householdLog?.sentPayloadJson).toContain('82,000円')

    const personalLog = (
      await h.logRepository.findAllByIdempotencyKey(
        `monthly_report_personal_summary:${REPORT_ID}:user-honey`,
      )
    ).at(-1)
    expect(personalLog?.target).toEqual({ kind: 'personal_dm', userId: 'user-honey' })
  })

  it('共通トークルーム未参加でも個人 DM への配信は続行する', async () => {
    const h = await buildHarness({ joined: false })
    await h.publishConfirmed()

    expect(h.lineGateway.sends.map(s => s.to)).toEqual(['user-honey', 'user-darling'])
    expect(h.events.filter(e => e.type === 'MonthlyReportHouseholdSummaryDelivered')).toHaveLength(
      0,
    )
    expect(h.events.filter(e => e.type === 'MonthlyReportPersonalSummaryDelivered')).toHaveLength(2)
  })

  it('レポートが見つからなければ何もしない', async () => {
    const h = await buildHarness({ savedReport: null })
    await h.publishConfirmed()

    expect(h.lineGateway.sends).toHaveLength(0)
    expect(h.events).toHaveLength(0)
  })

  it('夫婦の片方が未登録なら 1 通も配信しない（過少な世帯費用を確定値として流さない）', async () => {
    const h = await buildHarness({
      users: [appUser('honey', 'user-honey')],
      completedUserIds: ['user-honey'],
    })
    await h.publishConfirmed()

    expect(h.lineGateway.sends).toHaveLength(0)
    expect(h.events).toHaveLength(0)
  })

  it('通知機能が未有効化の相手がいる世帯には世帯サマリを送らず、スキップとして記録する', async () => {
    const h = await buildHarness({
      users: [appUser('honey', 'user-honey'), appUser('darling', 'user-darling', false)],
    })
    await h.publishConfirmed()

    // 世帯サマリは送らない。有効化済みの honey への個人 DM は送る
    expect(h.lineGateway.sends.map(s => s.to)).toEqual(['user-honey'])
    const householdLog = (
      await h.logRepository.findAllByIdempotencyKey(`monthly_report_household_summary:${REPORT_ID}`)
    ).at(-1)
    expect(householdLog?.resultStatus).toMatchObject({
      kind: 'skipped',
      skipReason: 'notification_disabled',
    })
    const darlingLog = (
      await h.logRepository.findAllByIdempotencyKey(
        `monthly_report_personal_summary:${REPORT_ID}:user-darling`,
      )
    ).at(-1)
    expect(darlingLog?.resultStatus).toMatchObject({
      kind: 'skipped',
      skipReason: 'notification_disabled',
    })
    expect(h.events).toHaveLength(1)
    expect(h.events[0]).toMatchObject({ type: 'MonthlyReportPersonalSummaryDelivered' })
  })

  it('世帯サマリの配信が例外で落ちても個人サマリは配信される', async () => {
    const h = await buildHarness({ failHouseholdSummary: true })
    await h.publishConfirmed()

    expect(h.lineGateway.sends.map(s => s.to)).toEqual(['user-honey', 'user-darling'])
    expect(h.events.filter(e => e.type === 'MonthlyReportPersonalSummaryDelivered')).toHaveLength(2)
  })

  it('LINE 送信に失敗した宛先の配信イベントは発行しない', async () => {
    const h = await buildHarness({
      pushResult: { kind: 'failure', failureReason: 'line_api_failure', detail: 'stub' },
    })
    await h.publishConfirmed()

    expect(h.lineGateway.sends).toHaveLength(3)
    expect(h.events).toHaveLength(0)
  })
})
