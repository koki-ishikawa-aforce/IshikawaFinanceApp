/**
 * 加盟店学習ルール Repository I/F
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.1
 *
 * F-1: 全検索はユーザーID を必須とし、配偶者の学習データに触れない。
 * 一意性（userId + merchantName）は save 前の findByMerchant で保証する（Phase 5 M-B）。
 */
import type { UserId } from '../../shared/ids'
import type { MerchantLearningRule } from '../aggregates/MerchantLearningRule'

export interface MerchantLearningRuleRepository {
  findByMerchant(userId: UserId, merchantName: string): Promise<MerchantLearningRule | null>
  findAllByUser(userId: UserId): Promise<MerchantLearningRule[]>
  save(rule: MerchantLearningRule): Promise<void>
}
