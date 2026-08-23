/**
 * MerchantLearningRuleRepository の PostgreSQL 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * PK = 複合自然キー (user_id, merchant_name)。一意性は PK 自体が保証し、
 * save は同一キーへの upsert（active ⇔ disabled の状態遷移を上書き）。
 * F-1: 全検索は user_id 起点で配偶者の学習データに触れない。
 */
import { and, asc, eq } from 'drizzle-orm'
import type { MerchantLearningRule, MerchantLearningRuleRepository, UserId } from '@warimaru/domain'
import { MerchantLearningRuleSchema } from '@warimaru/domain'
import type { Db } from '../client'
import { merchantLearningRules } from '../schema'
import { parsePayload, serializeForPayload } from '../serialize'

export class PostgresMerchantLearningRuleRepository implements MerchantLearningRuleRepository {
  constructor(private readonly db: Db) {}

  async findByMerchant(userId: UserId, merchantName: string): Promise<MerchantLearningRule | null> {
    const rows = await this.db
      .select({ payload: merchantLearningRules.payload })
      .from(merchantLearningRules)
      .where(
        and(
          eq(merchantLearningRules.userId, userId),
          eq(merchantLearningRules.merchantName, merchantName),
        ),
      )
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(MerchantLearningRuleSchema, row.payload)
  }

  async findAllByUser(userId: UserId): Promise<MerchantLearningRule[]> {
    const rows = await this.db
      .select({ payload: merchantLearningRules.payload })
      .from(merchantLearningRules)
      .where(eq(merchantLearningRules.userId, userId))
      .orderBy(asc(merchantLearningRules.merchantName))
    return rows.map(row => parsePayload(MerchantLearningRuleSchema, row.payload))
  }

  async save(rule: MerchantLearningRule): Promise<void> {
    const row = {
      userId: rule.common.userId,
      merchantName: rule.common.merchantName,
      kind: rule.kind,
      payload: serializeForPayload(rule),
    }
    await this.db
      .insert(merchantLearningRules)
      .values(row)
      .onConflictDoUpdate({
        target: [merchantLearningRules.userId, merchantLearningRules.merchantName],
        set: { kind: row.kind, payload: row.payload, updatedAt: new Date() },
      })
  }
}
