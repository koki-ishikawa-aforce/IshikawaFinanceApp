/**
 * transactions テーブル（集約 #7 取引）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §4.1
 */
import { pgTable, text, integer, timestamp, jsonb, check, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const transactions = pgTable(
  'transactions',
  {
    transactionId: text('transaction_id').primaryKey(),
    ownerUserId: text('owner_user_id').notNull(),
    kind: text('kind').notNull(),
    merchantName: text('merchant_name').notNull(),
    amount: integer('amount').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    // classified のときのみ非 NULL（DashboardQuery / TransactionListQuery の集計・絞り込み用昇格）
    categoryId: text('category_id'),
    expenseClass: text('expense_class'),
    payload: jsonb('payload').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  t => [
    check('transactions_kind_check', sql`${t.kind} IN ('unclassified', 'classified', 'deleted')`),
    check(
      'transactions_expense_class_check',
      sql`${t.expenseClass} IN ('household', 'personal_honey', 'personal_darling', 'business_expense')`,
    ),
    // 昇格カラムの片割れ残存（例: deleted 行に expense_class だけ残る）を防ぐ
    check(
      'transactions_promoted_pair_check',
      sql`num_nonnulls(${t.categoryId}, ${t.expenseClass}) IN (0, 2)`,
    ),
    check(
      'transactions_classified_pair_check',
      sql`(${t.kind} = 'classified') = (num_nonnulls(${t.categoryId}, ${t.expenseClass}) = 2)`,
    ),
    // findByMonth(ownerId, month) / TransactionListQuery.fetch(month 絞り込み)
    index('idx_transactions_owner_occurred').on(t.ownerUserId, t.occurredAt),
    // fetchUnclassifiedSummary / isUnclassifiedOnly
    index('idx_transactions_unclassified')
      .on(t.ownerUserId, t.occurredAt)
      .where(sql`${t.kind} = 'unclassified'`),
  ],
)
