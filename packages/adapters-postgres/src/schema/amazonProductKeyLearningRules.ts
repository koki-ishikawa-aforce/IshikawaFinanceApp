/**
 * amazon_product_key_learning_rules テーブル（集約 #5 Amazon商品キー学習ルール）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * PK = 複合自然キー (user_id, amazon_product_key)。専用 ID なし。
 * 本集約は discriminated union ではないため kind 昇格もない
 * （spec §5 カタログの「昇格カラム kind」は誤りとして Step 7 で訂正）。
 */
import { pgTable, text, timestamp, jsonb, primaryKey } from 'drizzle-orm/pg-core'

export const amazonProductKeyLearningRules = pgTable(
  'amazon_product_key_learning_rules',
  {
    userId: text('user_id').notNull(),
    amazonProductKey: text('amazon_product_key').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  t => [primaryKey({ columns: [t.userId, t.amazonProductKey] })],
)
