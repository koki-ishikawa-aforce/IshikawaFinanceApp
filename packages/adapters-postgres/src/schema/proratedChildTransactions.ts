/**
 * prorated_child_transactions テーブル（集約 #12 按分子取引）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * parent_transaction_id は家計分析コンテキストの取引への外部参照のため
 * FK を張らない（§2.1「コンテキストをまたぐ参照は ID のみ」）。
 */
import { pgTable, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core'

export const proratedChildTransactions = pgTable(
  'prorated_child_transactions',
  {
    childTransactionId: text('child_transaction_id').primaryKey(),
    parentTransactionId: text('parent_transaction_id').notNull(),
    userId: text('user_id').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  t => [
    // findByParent
    index('idx_prorated_children_parent').on(t.parentTransactionId),
  ],
)
