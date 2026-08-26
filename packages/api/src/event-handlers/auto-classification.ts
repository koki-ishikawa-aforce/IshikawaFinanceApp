import { LearningRuleUpdatedSchema, reflectManualClassification } from '@warimaru/domain'
import type {
  EventBus,
  MerchantLearningRuleRepository,
  TransactionManuallyClassified,
} from '@warimaru/domain'
import { domainEventBase } from './event-base.js'
import { safeSubscribe } from './safe-subscribe.js'

export interface AutoClassificationHandlerDeps {
  merchantLearningRuleRepository: MerchantLearningRuleRepository
}

/**
 * イベントチェーン: 取引分類 → 学習ルール更新（#34）
 *
 * 取引が手動分類確定したイベントを受けて、加盟店学習ルールへ即時反映し、
 * 更新軸ごとに LearningRuleUpdated を発火する
 * （08b §2「手動修正を学習に反映する」、I-1 即時反映、T-2 軸独立）。
 *
 * AMAZON.CO.JP の取引は加盟店学習の対象外（reflectManualClassification が
 * amazon_merchant で skip する）。代わりに学習する経路（X-1 Amazon商品キー学習）は
 * 2026-08-23 に取り下げた（#572）ため、Amazon の取引はどこにも学習されない。
 * 除外は維持すると決定済み（OQ-18 改訂 / #581）。
 *
 * 配信は at-least-once。反映は「値が変わらなければ unchanged」で冪等なため再配信で二重書きしない。
 */
export function registerAutoClassificationEventHandlers(
  eventBus: EventBus,
  deps: AutoClassificationHandlerDeps,
): void {
  safeSubscribe<TransactionManuallyClassified>(
    eventBus,
    'TransactionManuallyClassified',
    async event => {
      const existing = await deps.merchantLearningRuleRepository.findByMerchant(
        event.userId,
        event.merchantName,
      )
      const result = reflectManualClassification(
        existing,
        event.userId,
        event.merchantName,
        event.confirmedClassification,
        event.occurredAt,
      )
      if (result.kind !== 'updated') return
      await deps.merchantLearningRuleRepository.save(result.rule)
      for (const axis of result.updatedAxes) {
        await eventBus.publish(
          LearningRuleUpdatedSchema.parse({
            ...domainEventBase(),
            type: 'LearningRuleUpdated',
            userId: event.userId,
            merchantName: event.merchantName,
            axis,
          }),
        )
      }
    },
  )
}
