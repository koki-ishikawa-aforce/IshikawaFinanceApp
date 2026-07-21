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
 * 取引が手動分類確定したイベントを受けて、加盟店学習ルールへ即時反映する
 * （08b §2「手動修正を学習に反映する」、I-1 即時反映）。
 * 更新された軸ごとに LearningRuleUpdated を発火する（T-2）。
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
