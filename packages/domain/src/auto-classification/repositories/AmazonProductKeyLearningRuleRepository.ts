/**
 * Amazon商品キー学習ルール Repository I/F
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.1
 */
import type { UserId } from '../../shared/ids'
import type { AmazonProductKey } from '../../shared/value-objects/AmazonProductKey'
import type { AmazonProductKeyLearningRule } from '../aggregates/AmazonProductKeyLearningRule'

export interface AmazonProductKeyLearningRuleRepository {
  findByProductKey(
    userId: UserId,
    amazonProductKey: AmazonProductKey,
  ): Promise<AmazonProductKeyLearningRule | null>
  save(rule: AmazonProductKeyLearningRule): Promise<void>
}
