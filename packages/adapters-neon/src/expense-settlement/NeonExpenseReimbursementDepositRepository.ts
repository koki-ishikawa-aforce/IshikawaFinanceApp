/**
 * ExpenseReimbursementDepositRepository の Neon 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * findAwaitingByUser は partial index (user_id) WHERE kind = 'awaiting_match' が効く形。
 * 突合の冪等性は application service の責務（M-A の JSDoc どおり）。
 */
import { and, asc, eq } from 'drizzle-orm'
import type {
  ExpenseReimbursementDeposit,
  ExpenseReimbursementDepositRepository,
  ExpenseReimbursementId,
  UserId,
} from '@warimaru/domain'
import { ExpenseReimbursementDepositSchema } from '@warimaru/domain'
import type { Db } from '../client'
import { expenseReimbursementDeposits } from '../schema'
import { parsePayload, serializeForPayload } from '../serialize'

export class NeonExpenseReimbursementDepositRepository implements ExpenseReimbursementDepositRepository {
  constructor(private readonly db: Db) {}

  async findById(id: ExpenseReimbursementId): Promise<ExpenseReimbursementDeposit | null> {
    const rows = await this.db
      .select({ payload: expenseReimbursementDeposits.payload })
      .from(expenseReimbursementDeposits)
      .where(eq(expenseReimbursementDeposits.expenseReimbursementId, id))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(ExpenseReimbursementDepositSchema, row.payload)
  }

  async findAwaitingByUser(userId: UserId): Promise<ExpenseReimbursementDeposit[]> {
    const rows = await this.db
      .select({ payload: expenseReimbursementDeposits.payload })
      .from(expenseReimbursementDeposits)
      .where(
        and(
          eq(expenseReimbursementDeposits.userId, userId),
          eq(expenseReimbursementDeposits.kind, 'awaiting_match'),
        ),
      )
      .orderBy(asc(expenseReimbursementDeposits.expenseReimbursementId))
    return rows.map(row => parsePayload(ExpenseReimbursementDepositSchema, row.payload))
  }

  async save(deposit: ExpenseReimbursementDeposit): Promise<void> {
    const row = {
      expenseReimbursementId: deposit.common.expenseReimbursementId,
      userId: deposit.common.userId,
      kind: deposit.kind,
      payload: serializeForPayload(deposit),
    }
    const { expenseReimbursementId: _pk, ...updateSet } = row
    await this.db
      .insert(expenseReimbursementDeposits)
      .values(row)
      .onConflictDoUpdate({
        target: expenseReimbursementDeposits.expenseReimbursementId,
        set: { ...updateSet, updatedAt: new Date() },
      })
  }
}
