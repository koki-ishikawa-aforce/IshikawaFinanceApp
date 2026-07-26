/**
 * expense_reimbursement_deposits テーブル（集約 #13 経費精算入金）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * partial index は findAwaitingByUser 用。kind の実値は 'awaiting_match'
 * （spec §5 カタログの 'awaiting' は誤記として Step 7 で訂正）。
 */
import { pgTable, text, timestamp, jsonb, check, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const expenseReimbursementDeposits = pgTable(
  'expense_reimbursement_deposits',
  {
    expenseReimbursementId: text('expense_reimbursement_id').primaryKey(),
    userId: text('user_id').notNull(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  t => [
    check(
      'expense_reimbursement_deposits_kind_check',
      sql`${t.kind} IN ('awaiting_match', 'matched', 'unrecognized_confirmed')`,
    ),
    // findAwaitingByUser
    index('idx_expense_deposits_awaiting')
      .on(t.userId)
      .where(sql`${t.kind} = 'awaiting_match'`),
  ],
)
