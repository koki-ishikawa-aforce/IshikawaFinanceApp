/**
 * bank_deposits テーブル（集約 BankDeposit 銀行入金 / 入金用途判別、#390）
 * @see docs/domain/08d-ul-残高資産推移管理.md §1
 *
 * transaction_id に一意制約を置く（集約の不変条件「取引ID で一意」の最終保証）。
 * 同一の入金メールを再取込しても入金変動が二重に生まれないようにするためで、
 * これが無いと残高が黙って二重加算される。
 *
 * partial index は findAwaitingManualConfirmationByUser 用。
 */
import { pgTable, text, timestamp, jsonb, check, index, unique } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const bankDeposits = pgTable(
  'bank_deposits',
  {
    bankDepositId: text('bank_deposit_id').primaryKey(),
    transactionId: text('transaction_id').notNull(),
    accountId: text('account_id').notNull(),
    userId: text('user_id').notNull(),
    kind: text('kind').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  t => [
    unique('bank_deposits_transaction_id_unique').on(t.transactionId),
    check(
      'bank_deposits_kind_check',
      sql`${t.kind} IN ('salary', 'expense_reimbursement', 'other_savings_return', 'unknown')`,
    ),
    // findAwaitingManualConfirmationByUser
    index('idx_bank_deposits_awaiting')
      .on(t.userId, t.occurredAt)
      .where(sql`${t.kind} = 'unknown'`),
  ],
)
