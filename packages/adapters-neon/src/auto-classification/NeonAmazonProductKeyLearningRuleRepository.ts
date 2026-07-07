/**
 * AmazonProductKeyLearningRuleRepository の Neon 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * PK = 複合自然キー (user_id, amazon_product_key)。
 * F-1: 検索は user_id 起点で配偶者の学習データに触れない。
 */
import { and, eq } from 'drizzle-orm'
import type {
  AmazonProductKey,
  AmazonProductKeyLearningRule,
  AmazonProductKeyLearningRuleRepository,
  UserId,
} from '@warimaru/domain'
import { AmazonProductKeyLearningRuleSchema } from '@warimaru/domain'
import type { Db } from '../client'
import { amazonProductKeyLearningRules } from '../schema'
import { parsePayload, serializeForPayload } from '../serialize'

export class NeonAmazonProductKeyLearningRuleRepository implements AmazonProductKeyLearningRuleRepository {
  constructor(private readonly db: Db) {}

  async findByProductKey(
    userId: UserId,
    amazonProductKey: AmazonProductKey,
  ): Promise<AmazonProductKeyLearningRule | null> {
    const rows = await this.db
      .select({ payload: amazonProductKeyLearningRules.payload })
      .from(amazonProductKeyLearningRules)
      .where(
        and(
          eq(amazonProductKeyLearningRules.userId, userId),
          eq(amazonProductKeyLearningRules.amazonProductKey, amazonProductKey),
        ),
      )
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(AmazonProductKeyLearningRuleSchema, row.payload)
  }

  async save(rule: AmazonProductKeyLearningRule): Promise<void> {
    const row = {
      userId: rule.userId,
      amazonProductKey: rule.amazonProductKey,
      payload: serializeForPayload(rule),
    }
    await this.db
      .insert(amazonProductKeyLearningRules)
      .values(row)
      .onConflictDoUpdate({
        target: [
          amazonProductKeyLearningRules.userId,
          amazonProductKeyLearningRules.amazonProductKey,
        ],
        set: { payload: row.payload, updatedAt: new Date() },
      })
  }
}
