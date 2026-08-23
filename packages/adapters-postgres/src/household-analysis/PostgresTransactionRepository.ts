/**
 * TransactionRepository の PostgreSQL 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §4.1
 */
import { and, asc, eq, gte, lt, sql } from 'drizzle-orm'
import type {
  CategoryId,
  ClassifiedTransaction,
  ExpenseTypeId,
  Transaction,
  TransactionId,
  TransactionRepository,
  UserId,
  YearMonth,
} from '@warimaru/domain'
import { TransactionSchema } from '@warimaru/domain'
import type { Db } from '../client'
import { transactions } from '../schema'
import { parsePayload, serializeForPayload } from '../serialize'
import { yearMonthToUtcRange } from '../yearMonthToUtcRange'

export class PostgresTransactionRepository implements TransactionRepository {
  constructor(private readonly db: Db) {}

  async findById(id: TransactionId): Promise<Transaction | null> {
    const rows = await this.db
      .select({ payload: transactions.payload })
      .from(transactions)
      .where(eq(transactions.transactionId, id))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(TransactionSchema, row.payload)
  }

  async findByMonth(ownerId: UserId, month: YearMonth): Promise<Transaction[]> {
    const { fromUtc, toUtc } = yearMonthToUtcRange(month)
    const rows = await this.db
      .select({ payload: transactions.payload })
      .from(transactions)
      .where(
        and(
          eq(transactions.ownerUserId, ownerId),
          gte(transactions.occurredAt, fromUtc),
          lt(transactions.occurredAt, toUtc),
        ),
      )
      .orderBy(asc(transactions.occurredAt))
    // I/F 仕様どおり全 kind を返す（deleted 含む、プライバシー適用は Read 側の責務）
    return rows.map(row => parsePayload(TransactionSchema, row.payload))
  }

  async findClassifiedByCategory(categoryId: CategoryId): Promise<ClassifiedTransaction[]> {
    // category_id は分類済み取引のみ昇格される（save 参照）ため kind 条件と等価だが明示する
    const rows = await this.db
      .select({ payload: transactions.payload })
      .from(transactions)
      .where(and(eq(transactions.kind, 'classified'), eq(transactions.categoryId, categoryId)))
      .orderBy(asc(transactions.transactionId))
    return rows.map(row => parsePayload(TransactionSchema, row.payload) as ClassifiedTransaction)
  }

  async findClassifiedByExpenseType(
    expenseTypeId: ExpenseTypeId,
  ): Promise<ClassifiedTransaction[]> {
    // expense_type は昇格列を持たないため payload（details.expenseTypeRef union）を直接参照する
    const rows = await this.db
      .select({ payload: transactions.payload })
      .from(transactions)
      .where(
        and(
          eq(transactions.kind, 'classified'),
          sql`${transactions.payload}->'details'->'expenseTypeRef'->>'expenseTypeId' = ${expenseTypeId}`,
        ),
      )
      .orderBy(asc(transactions.transactionId))
    return rows.map(row => parsePayload(TransactionSchema, row.payload) as ClassifiedTransaction)
  }

  async save(transaction: Transaction): Promise<void> {
    const classified = transaction.kind === 'classified' ? transaction.details : null
    const row = {
      transactionId: transaction.common.transactionId,
      ownerUserId: transaction.common.ownerUserId,
      kind: transaction.kind,
      merchantName: transaction.common.merchantName,
      amount: transaction.common.amount,
      occurredAt: transaction.common.occurredAt,
      categoryId: classified === null ? null : classified.categoryId,
      expenseClass: classified === null ? null : classified.expenseClass,
      payload: serializeForPayload(transaction),
    }
    const { transactionId: _pk, ...updateSet } = row
    await this.db
      .insert(transactions)
      .values(row)
      .onConflictDoUpdate({
        target: transactions.transactionId,
        set: { ...updateSet, updatedAt: new Date() },
      })
  }
}
