/**
 * ドメインイベントハンドラーの登録（#34）
 *
 * 設計方針:
 * - 配信は同期・インプロセス（InMemoryEventBus）。ルートが集約を保存した後に
 *   publish し、ハンドラーの完了を await する
 * - ハンドラー例外は safeSubscribe で隔離し、API リクエストを失敗させない
 *   （リマップハンドラーは例外伝播が必要なため safeSubscribe を使わない — #89）
 * - 配信は at-least-once（リクエスト再実行で再発行されうる）ため、
 *   ハンドラーは冪等に実装する
 */
import type { EventBus } from '@warimaru/domain'
import type { AppDeps } from '../composition-root.js'
import { createNotificationDeliveryService } from '../notification/delivery-service.js'
import { registerAutoClassificationEventHandlers } from './auto-classification.js'
import { registerMasterDataRemapEventHandlers } from './master-data-remap.js'
import { registerMonthlyReportCsvConfirmationEventHandlers } from './monthly-report-csv-confirmation.js'
import { registerMonthlyReportFinalizationEventHandlers } from './monthly-report-finalization.js'
import { registerExpenseProrationRecalcEventHandlers } from './expense-proration-recalc.js'
import { registerNotificationDeliveryEventHandlers } from './notification-delivery.js'
import { registerUnpaidBalanceUpdateEventHandlers } from './unpaid-balance-update.js'

export { domainEventBase } from './event-base.js'

// 同一バスへの二重登録ガード（同じ deps で createApp が複数回呼ばれても重複購読しない）
const registeredBuses = new WeakSet<EventBus>()

export function registerEventHandlers(deps: AppDeps): void {
  if (registeredBuses.has(deps.eventBus)) return
  registeredBuses.add(deps.eventBus)
  registerAutoClassificationEventHandlers(deps.eventBus, {
    merchantLearningRuleRepository: deps.merchantLearningRuleRepository,
    amazonProductKeyLearningRuleRepository: deps.amazonProductKeyLearningRuleRepository,
  })
  registerMasterDataRemapEventHandlers(deps.eventBus, {
    transactionRepository: deps.transactionRepository,
    merchantLearningRuleRepository: deps.merchantLearningRuleRepository,
    amazonProductKeyLearningRuleRepository: deps.amazonProductKeyLearningRuleRepository,
    categoryDeletionRequestRepository: deps.categoryDeletionRequestRepository,
    expenseTypeDeletionRequestRepository: deps.expenseTypeDeletionRequestRepository,
  })
  registerMonthlyReportFinalizationEventHandlers(deps.eventBus, {
    monthlyExpenseCycleRepository: deps.monthlyExpenseCycleRepository,
    expenseReimbursementDepositRepository: deps.expenseReimbursementDepositRepository,
    monthlyReportRepository: deps.monthlyReportRepository,
  })
  // 月次上限変更 → 当月按分再計算 (#140)
  registerExpenseProrationRecalcEventHandlers(deps.eventBus, {
    monthlyLimitRepository: deps.monthlyLimitRepository,
    monthlyExpenseCycleRepository: deps.monthlyExpenseCycleRepository,
  })
  // CSV取込確定 → 月次レポート更新 (#69)
  registerMonthlyReportCsvConfirmationEventHandlers(deps.eventBus, {
    appUserRepository: deps.appUserRepository,
    transactionRepository: deps.transactionRepository,
    monthlyReportRepository: deps.monthlyReportRepository,
  })
  // 未払金計上・消込 → 口座残高更新 (#69)
  registerUnpaidBalanceUpdateEventHandlers(deps.eventBus, {
    mitsuiSumitomoUnpaidRepository: deps.mitsuiSumitomoUnpaidRepository,
    accountRepository: deps.accountRepository,
  })
  // 通知配信 (#36): AppDeps の Repository / Gateway から配信サービスを組み立てて購読する
  registerNotificationDeliveryEventHandlers(deps.eventBus, {
    notificationDeliveryService: createNotificationDeliveryService(deps),
  })
}
