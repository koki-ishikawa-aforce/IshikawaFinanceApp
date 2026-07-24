/**
 * ドメインイベントハンドラーの登録（#34）
 *
 * 設計方針:
 * - 配信は同期・インプロセス（InMemoryEventBus）。ルートが集約を保存した後に
 *   publish し、ハンドラーの完了を await する
 * - ハンドラー例外は safeSubscribe で隔離し、API リクエストを失敗させない
 * - 配信は at-least-once（リクエスト再実行で再発行されうる）ため、
 *   ハンドラーは冪等に実装する
 */
import type { EventBus } from '@warimaru/domain'
import type { AppDeps } from '../composition-root.js'
import { createNotificationDeliveryService } from '../notification/delivery-service.js'
import { registerAutoClassificationEventHandlers } from './auto-classification.js'
import { registerMasterDataRemapHandlers } from './master-data-remap-handlers.js'
import { registerMonthlyReportFinalizationEventHandlers } from './monthly-report-finalization.js'
import { registerNotificationDeliveryEventHandlers } from './notification-delivery.js'

export { domainEventBase } from './event-base.js'

// 同一バスへの二重登録ガード（同じ deps で createApp が複数回呼ばれても重複購読しない）
const registeredBuses = new WeakSet<EventBus>()

export function registerEventHandlers(deps: AppDeps): void {
  if (registeredBuses.has(deps.eventBus)) return
  registeredBuses.add(deps.eventBus)
  registerAutoClassificationEventHandlers(deps.eventBus, {
    merchantLearningRuleRepository: deps.merchantLearningRuleRepository,
  })
  registerMasterDataRemapHandlers(deps.eventBus, {
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
  // 通知配信 (#36): AppDeps の Repository / Gateway から配信サービスを組み立てて購読する
  registerNotificationDeliveryEventHandlers(deps.eventBus, {
    notificationDeliveryService: createNotificationDeliveryService(deps),
  })
}
