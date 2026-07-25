import {
  AmazonProductKeyMappingRegisteredSchema,
  LearningRuleUpdatedSchema,
  reflectAmazonProductKeyManualClassification,
  reflectManualClassification,
} from '@warimaru/domain'
import type {
  AmazonProductKeyLearningRuleRepository,
  EventBus,
  MerchantLearningRuleRepository,
  TransactionManuallyClassified,
} from '@warimaru/domain'
import { domainEventBase } from './event-base.js'
import { safeSubscribe } from './safe-subscribe.js'

export interface AutoClassificationHandlerDeps {
  merchantLearningRuleRepository: MerchantLearningRuleRepository
  amazonProductKeyLearningRuleRepository: AmazonProductKeyLearningRuleRepository
}

/**
 * イベントチェーン: 取引分類 → 学習ルール更新（#34, X-1 配線 #103）
 *
 * 取引が手動分類確定したイベントを受けて、学習ルールへ即時反映する
 * （08b §2「手動修正を学習に反映する」、I-1 即時反映）。
 *  - 通常加盟店: 加盟店学習ルールへ反映し、更新軸ごとに LearningRuleUpdated を発火する（T-2）
 *  - Amazon（商品キーあり, X-1）: AMAZON.CO.JP は加盟店学習の対象外のため、Amazon商品キー
 *    学習ルールへ反映し、AmazonProductKeyMappingRegistered を発火する。以降その商品キーで
 *    自動分類できるようになる（実際の商品キー供給経路は本 Issue のスコープ外, #103）
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
      // X-1: 商品キーを伴う確定は Amazon 取引（加盟店名 AMAZON.CO.JP）。加盟店学習は
      // 対象外（reflectManualClassification が amazon_merchant で skip）のため、商品キーの
      // 有無で経路を分け、Amazon商品キー学習ルールへ反映する。
      if (event.amazonProductKey !== undefined) {
        const existing = await deps.amazonProductKeyLearningRuleRepository.findByProductKey(
          event.userId,
          event.amazonProductKey,
        )
        const result = reflectAmazonProductKeyManualClassification(
          existing,
          event.userId,
          event.amazonProductKey,
          event.confirmedClassification,
          event.occurredAt,
        )
        if (result.kind !== 'updated') return
        await deps.amazonProductKeyLearningRuleRepository.save(result.rule)
        await eventBus.publish(
          AmazonProductKeyMappingRegisteredSchema.parse({
            ...domainEventBase(),
            type: 'AmazonProductKeyMappingRegistered',
            userId: event.userId,
            amazonProductKey: event.amazonProductKey,
          }),
        )
        return
      }

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
