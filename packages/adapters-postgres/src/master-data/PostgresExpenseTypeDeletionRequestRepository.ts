/**
 * ExpenseTypeDeletionRequestRepository の PostgreSQL 実装
 * @see docs/domain/08h-ul-マスタ管理.md §2
 *
 * state_kind は payload.state.kind の昇格列。PK 以外の一意制約は持たない。
 */
import { eq } from 'drizzle-orm'
import type {
  ExpenseTypeDeletionRequest,
  ExpenseTypeDeletionRequestId,
  ExpenseTypeDeletionRequestRepository,
} from '@warimaru/domain'
import { ExpenseTypeDeletionRequestSchema } from '@warimaru/domain'
import type { Db } from '../client'
import { expenseTypeDeletionRequests } from '../schema'
import { parsePayload, serializeForPayload } from '../serialize'

export class PostgresExpenseTypeDeletionRequestRepository implements ExpenseTypeDeletionRequestRepository {
  constructor(private readonly db: Db) {}

  async findById(id: ExpenseTypeDeletionRequestId): Promise<ExpenseTypeDeletionRequest | null> {
    const rows = await this.db
      .select({ payload: expenseTypeDeletionRequests.payload })
      .from(expenseTypeDeletionRequests)
      .where(eq(expenseTypeDeletionRequests.expenseTypeDeletionRequestId, id))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(ExpenseTypeDeletionRequestSchema, row.payload)
  }

  async save(request: ExpenseTypeDeletionRequest): Promise<void> {
    const row = {
      expenseTypeDeletionRequestId: request.expenseTypeDeletionRequestId,
      requestedByUserId: request.requestedByUserId,
      targetExpenseTypeId: request.targetExpenseTypeId,
      stateKind: request.state.kind,
      payload: serializeForPayload(request),
    }
    const { expenseTypeDeletionRequestId: _pk, ...updateSet } = row
    await this.db
      .insert(expenseTypeDeletionRequests)
      .values(row)
      .onConflictDoUpdate({
        target: expenseTypeDeletionRequests.expenseTypeDeletionRequestId,
        set: { ...updateSet, updatedAt: new Date() },
      })
  }
}
