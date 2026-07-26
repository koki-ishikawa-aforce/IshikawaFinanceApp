/**
 * イベントチェーン: 月次レポートCSV確定 → 月次レポートサマリの LINE 配信（#389）
 *
 * 08g §2「月次レポートサマリを共通トークルームに配信する」/「月次レポート個人サマリを
 * 個人DMに配信する」の発火元。家計分析が発行する MonthlyReportCsvConfirmed を購読し、
 * **夫婦両方の CSV 取込が完了している月に限り** サマリを配信する。
 *
 * 片方だけの取込で配信しない理由: 月次レポートの集計値は両者の取引が揃って初めて
 * 世帯の実額になる。先に取り込んだ側の分だけで配信すると、共通トークルームに
 * 過少な世帯費用が「その月の確定値」として流れ、後から訂正する手段が無い。
 *
 * 冪等性: 配信の冪等性キーは月次レポートID（+ 個人サマリは宛先ユーザーID）で、
 * 同一レポートへの再確定・イベント再配信では 2 通目を送らない。レポート値が後から
 * 遡及修正されても、配信済みの payload は LINE 配信ログに凍結されている（OQ-34）。
 *
 * プライバシー3段階ルール: 世帯サマリは世帯費用と資産のみ、個人サマリは宛先本人の
 * 個人費用・経費のみを載せる（本文の組み立ては message-content.ts が担う）。
 */
import type {
  AppUser,
  AppUserRepository,
  CategoryMasterRepository,
  CsvImportStatusQuery,
  EventBus,
  MonthlyReport,
  MonthlyReportCsvConfirmed,
  MonthlyReportRepository,
  SharedTalkRoomRepository,
  UserRole,
} from '@warimaru/domain'
import {
  DeliveryTargetSchema,
  MonthlyReportHouseholdSummaryDeliveredSchema,
  MonthlyReportPersonalSummaryDeliveredSchema,
  joinedTalkRoomIdOf,
} from '@warimaru/domain'
import type { NotificationDeliveryService } from '../notification/delivery-service.js'
import type { DeepLinkBuilder } from '../notification/deep-links.js'
import {
  buildHouseholdSummaryContent,
  buildPersonalSummaryContent,
} from '../notification/message-content.js'
import { domainEventBase } from './event-base.js'
import { safeSubscribe } from './safe-subscribe.js'

export interface MonthlyReportDeliveryHandlerDeps {
  notificationDeliveryService: NotificationDeliveryService
  monthlyReportRepository: MonthlyReportRepository
  appUserRepository: AppUserRepository
  sharedTalkRoomRepository: SharedTalkRoomRepository
  csvImportStatusQuery: CsvImportStatusQuery
  categoryMasterRepository: CategoryMasterRepository
  deepLinks: DeepLinkBuilder
}

export function registerMonthlyReportDeliveryEventHandlers(
  eventBus: EventBus,
  deps: MonthlyReportDeliveryHandlerDeps,
): void {
  /** 夫婦の登録済みユーザー（役割つき）。未登録の役割は含めない */
  async function members(): Promise<{ user: AppUser; role: UserRole }[]> {
    const roles: UserRole[] = ['honey', 'darling']
    const found = await Promise.all(
      roles.map(async role => {
        const user = await deps.appUserRepository.findByRole(role)
        return user === null ? null : { user, role }
      }),
    )
    return found.filter(entry => entry !== null)
  }

  /** カテゴリID → 表示名の解決関数（世帯共有カテゴリは誰から見ても可視） */
  async function categoryNameResolver(
    viewerUserId: AppUser['common']['userId'],
  ): Promise<(categoryId: string) => string | undefined> {
    const categories = await deps.categoryMasterRepository.findAllVisibleToUser(viewerUserId)
    const nameById = new Map(categories.map(c => [String(c.categoryId), c.name]))
    return categoryId => nameById.get(categoryId)
  }

  async function deliverHouseholdSummary(
    report: MonthlyReport,
    viewerUserId: AppUser['common']['userId'],
  ): Promise<void> {
    const talkRoomId = joinedTalkRoomIdOf(await deps.sharedTalkRoomRepository.find())
    if (talkRoomId === undefined) {
      console.warn(
        `[notification] 共通トークルーム未参加のため月次レポート世帯サマリを送れない: ${report.common.targetYearMonth}`,
      )
      return
    }

    const outcome = await deps.notificationDeliveryService.deliver({
      target: DeliveryTargetSchema.parse({ kind: 'shared_talk_room', talkRoomId }),
      content: buildHouseholdSummaryContent(
        report,
        await categoryNameResolver(viewerUserId),
        deps.deepLinks,
      ),
      purpose: 'monthly_report_household_summary',
      idempotencyKey: `monthly_report_household_summary:${report.common.monthlyReportId}`,
    })
    if (outcome.kind !== 'sent') return

    await eventBus.publish(
      MonthlyReportHouseholdSummaryDeliveredSchema.parse({
        ...domainEventBase(),
        type: 'MonthlyReportHouseholdSummaryDelivered',
        deliveryMessageId: outcome.message.common.deliveryMessageId,
        monthlyReportId: report.common.monthlyReportId,
        talkRoomId,
      }),
    )
  }

  async function deliverPersonalSummary(
    report: MonthlyReport,
    member: { user: AppUser; role: UserRole },
  ): Promise<void> {
    const userId = member.user.common.userId
    const outcome = await deps.notificationDeliveryService.deliver({
      target: DeliveryTargetSchema.parse({ kind: 'personal_dm', userId }),
      content: buildPersonalSummaryContent(report, member.role, deps.deepLinks),
      purpose: 'monthly_report_personal_summary',
      idempotencyKey: `monthly_report_personal_summary:${report.common.monthlyReportId}:${userId}`,
    })
    if (outcome.kind !== 'sent') return

    await eventBus.publish(
      MonthlyReportPersonalSummaryDeliveredSchema.parse({
        ...domainEventBase(),
        type: 'MonthlyReportPersonalSummaryDelivered',
        deliveryMessageId: outcome.message.common.deliveryMessageId,
        monthlyReportId: report.common.monthlyReportId,
        userId,
      }),
    )
  }

  safeSubscribe<MonthlyReportCsvConfirmed>(eventBus, 'MonthlyReportCsvConfirmed', async event => {
    const report = await deps.monthlyReportRepository.findById(event.monthlyReportId)
    if (report === null) return

    const registered = await members()
    if (registered.length === 0) return

    const completions = await Promise.all(
      registered.map(({ user }) =>
        deps.csvImportStatusQuery.fetchCompletion(
          user.common.userId,
          report.common.targetYearMonth,
        ),
      ),
    )
    // 夫婦の一方でも未取込なら配信しない（次に相手が取り込んだ時点の再確定で配信される）
    if (completions.some(completion => completion === null)) return

    const [first] = registered
    if (first === undefined) return
    await deliverHouseholdSummary(report, first.user.common.userId)
    for (const member of registered) {
      await deliverPersonalSummary(report, member)
    }
  })
}
