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
import type { AppDeps } from '../composition-root.js'
import { registerAutoClassificationEventHandlers } from './auto-classification.js'

export { domainEventBase } from './event-base.js'

export function registerEventHandlers(deps: AppDeps): void {
  registerAutoClassificationEventHandlers(deps.eventBus, {
    merchantLearningRuleRepository: deps.merchantLearningRuleRepository,
  })
}
