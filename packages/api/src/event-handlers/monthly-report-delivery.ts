/**
 * イベントチェーン: 月次レポートCSV確定 → 月次レポートサマリの LINE 配信（#389）
 *
 * 08g §2「月次レポートサマリを共通トークルームに配信する」/「月次レポート個人サマリを
 * 個人DMに配信する」の発火元。家計分析が発行する MonthlyReportCsvConfirmed を購読し、
 * **夫婦 2 人が登録済みで、その両方の CSV 取込が完了している月に限り** サマリを配信する。
 *
 * 揃うまで配信しない理由: 月次レポートの集計値は両者の取引が揃って初めて世帯の実額になる。
 * 先に取り込んだ側の分だけで配信すると、共通トークルームに過少な世帯費用が「その月の
 * 確定値」として流れる。配信の冪等性キーは月次レポートID固定で訂正版を送れないため、
 * 誤った額が恒久的に残ってしまう。片方が未登録の世帯も同じ理由で配信しない。
 *
 * 冪等性: 配信の冪等性キーは月次レポートID（+ 個人サマリは宛先ユーザーID）で、
 * 同一レポートへの再確定・イベント再配信では 2 通目を送らない。レポート値が後から
 * 遡及修正されても、配信済みの payload は LINE 配信ログに凍結されている（OQ-34）。
 *
 * プライバシー3段階ルール: 世帯サマリは世帯費用と資産のみ、個人サマリは宛先本人の
 * 個人費用・経費のみを載せる（本人分の抜き出しはドメインの `selfTotalsOf` が単一ソース）。
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
  isNotificationActivated,
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

/** 世帯は夫婦 2 人固定（OQ-53 ②）。両者が揃うまでサマリは配信しない */
const HOUSEHOLD_MEMBER_COUNT = 2

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
  /** 登録済みの夫婦。未登録の役割は含めない */
  async function members(): Promise<AppUser[]> {
    const roles: UserRole[] = ['honey', 'darling']
    const found = await Promise.all(roles.map(role => deps.appUserRepository.findByRole(role)))
    return found.filter(user => user !== null)
  }

  /**
   * カテゴリID → 表示名の解決関数。
   *
   * 閲覧者スコープ（`findAllVisibleToUser`）では、世帯費用に配偶者の追加カテゴリが
   * 使われていたときに誰を基準にするかで名前が出たり「その他」になったりする。
   * 共通トークルーム宛の本文が閲覧者に依存しないよう ID から直接引く。
   */
  async function categoryNameResolver(
    categoryIds: readonly string[],
  ): Promise<(categoryId: string) => string | undefined> {
    const unique = [...new Set(categoryIds)]
    const found = await Promise.all(
      unique.map(async id => {
        const category = await deps.categoryMasterRepository.findById(id as never)
        return category === null ? null : ([id, category.name] as const)
      }),
    )
    const nameById = new Map(found.filter(entry => entry !== null))
    return categoryId => nameById.get(categoryId)
  }

  async function deliverHouseholdSummary(
    report: MonthlyReport,
    registered: readonly AppUser[],
  ): Promise<void> {
    const talkRoomId = joinedTalkRoomIdOf(await deps.sharedTalkRoomRepository.find())
    if (talkRoomId === undefined) {
      console.warn(
        '[notification] 共通トークルーム未参加のため月次レポート世帯サマリを送れない' +
          `（${report.common.targetYearMonth} / report=${report.common.monthlyReportId}）。` +
          '参加しただけでは再配信されないため、回復には対象月の CSV 再取込が要る',
      )
      return
    }

    const target = DeliveryTargetSchema.parse({ kind: 'shared_talk_room', talkRoomId })
    const buildContent = async () =>
      buildHouseholdSummaryContent(
        report,
        await categoryNameResolver(report.common.householdCategoryTotals.map(c => c.categoryId)),
        deps.deepLinks,
      )
    const idempotencyKey = `monthly_report_household_summary:${report.common.monthlyReportId}`

    // 共通トークルームは世帯にひとつのため、どちらかが無効化していれば送らない
    // （08g §2「事前: 通知機能が有効化済み」。黙って送るのも黙って落とすのも避け、記録を残す）
    if (!registered.every(isNotificationActivated)) {
      await deps.notificationDeliveryService.skip({
        target,
        content: buildContent,
        purpose: 'monthly_report_household_summary',
        idempotencyKey,
        skipReason: 'notification_disabled',
      })
      return
    }

    const outcome = await deps.notificationDeliveryService.deliver({
      target,
      content: buildContent,
      purpose: 'monthly_report_household_summary',
      idempotencyKey,
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

  async function deliverPersonalSummary(report: MonthlyReport, user: AppUser): Promise<void> {
    const userId = user.common.userId
    // 役割は集約が持つ値を使う（findByRole の検索キーではなく、載せる金額の真実の源に合わせる）
    const role = user.common.role
    const target = DeliveryTargetSchema.parse({ kind: 'personal_dm', userId })
    const buildContent = (): ReturnType<typeof buildPersonalSummaryContent> =>
      buildPersonalSummaryContent(report, role, deps.deepLinks)
    const idempotencyKey = `monthly_report_personal_summary:${report.common.monthlyReportId}:${userId}`

    if (!isNotificationActivated(user)) {
      await deps.notificationDeliveryService.skip({
        target,
        content: buildContent,
        purpose: 'monthly_report_personal_summary',
        idempotencyKey,
        skipReason: 'notification_disabled',
      })
      return
    }

    const outcome = await deps.notificationDeliveryService.deliver({
      target,
      content: buildContent,
      purpose: 'monthly_report_personal_summary',
      idempotencyKey,
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

  /**
   * 1 通の失敗で残りを巻き添えにしない。
   * 冪等性キーが宛先ごとに違うため、成功済みの宛先が再実行で二重送信されることはない。
   */
  async function deliverIsolated(label: string, deliver: () => Promise<void>): Promise<void> {
    try {
      await deliver()
    } catch (e) {
      console.error(`[notification] 月次レポートサマリの配信に失敗した（${label}）:`, e)
    }
  }

  safeSubscribe<MonthlyReportCsvConfirmed>(eventBus, 'MonthlyReportCsvConfirmed', async event => {
    const report = await deps.monthlyReportRepository.findById(event.monthlyReportId)
    if (report === null) {
      // 直前に保存されたはずの集約が引けない = 整合性の破れ。業務上のスキップと混ぜない
      console.error(
        `[notification] 月次レポートが見つからずサマリを配信できない: ${event.monthlyReportId}`,
      )
      return
    }
    const month = report.common.targetYearMonth

    const registered = await members()
    if (registered.length < HOUSEHOLD_MEMBER_COUNT) {
      console.warn(
        `[notification] 夫婦 2 人が揃っていないため月次レポートサマリを配信しない（${month}: 登録 ${registered.length} 名）`,
      )
      return
    }

    const completions = await Promise.all(
      registered.map(user => deps.csvImportStatusQuery.fetchCompletion(user.common.userId, month)),
    )
    const pendingRoles = registered
      .filter((_, index) => completions[index] === null)
      .map(user => user.common.role)
    if (pendingRoles.length > 0) {
      // 相手の取込で再確定されたときに配信される。ただし対象月のレポートが既に最終確定済みだと
      // CSV 確定ハンドラーが再発行を打ち切るため、その場合はこの警告が唯一の記録になる
      console.warn(
        `[notification] CSV 未取込の相手がいるため月次レポートサマリを配信しない（${month}: ${pendingRoles.join(' / ')}）`,
      )
      return
    }

    await deliverIsolated(`${month} 世帯サマリ`, () => deliverHouseholdSummary(report, registered))
    for (const user of registered) {
      await deliverIsolated(`${month} 個人サマリ(${user.common.role})`, () =>
        deliverPersonalSummary(report, user),
      )
    }
  })
}
