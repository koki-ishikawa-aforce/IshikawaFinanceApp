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
import { registerAutoClassificationEventHandlers } from './auto-classification.js'

export { domainEventBase } from './event-base.js'

// 同一バスへの二重登録ガード（同じ deps で createApp が複数回呼ばれても重複購読しない）
const registeredBuses = new WeakSet<EventBus>()

export function registerEventHandlers(deps: AppDeps): void {
  if (registeredBuses.has(deps.eventBus)) return
  registeredBuses.add(deps.eventBus)
  registerAutoClassificationEventHandlers(deps.eventBus, {
    merchantLearningRuleRepository: deps.merchantLearningRuleRepository,
  })
}
