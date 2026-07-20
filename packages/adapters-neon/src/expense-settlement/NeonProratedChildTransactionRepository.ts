/**
 * ProratedChildTransactionRepository の Neon 実装
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 */
import { asc, eq } from 'drizzle-orm'
import type {
  ChildTransactionId,
  ProratedChildTransaction,
  ProratedChildTransactionRepository,
  TransactionId,
} from '@warimaru/domain'
import { ProratedChildTransactionSchema } from '@warimaru/domain'
import type { Db } from '../client'
import { proratedChildTransactions } from '../schema'
import { parsePayload, serializeForPayload } from '../serialize'

export class NeonProratedChildTransactionRepository implements ProratedChildTransactionRepository {
  constructor(private readonly db: Db) {}

  async findById(id: ChildTransactionId): Promise<ProratedChildTransaction | null> {
    const rows = await this.db
      .select({ payload: proratedChildTransactions.payload })
      .from(proratedChildTransactions)
      .where(eq(proratedChildTransactions.childTransactionId, id))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(ProratedChildTransactionSchema, row.payload)
  }

  async findByParent(parentTransactionId: TransactionId): Promise<ProratedChildTransaction[]> {
    const rows = await this.db
      .select({ payload: proratedChildTransactions.payload })
      .from(proratedChildTransactions)
      .where(eq(proratedChildTransactions.parentTransactionId, parentTransactionId))
      .orderBy(asc(proratedChildTransactions.childTransactionId))
    return rows.map(row => parsePayload(ProratedChildTransactionSchema, row.payload))
  }

  async save(child: ProratedChildTransaction): Promise<void> {
    const row = {
      childTransactionId: child.childTransactionId,
      parentTransactionId: child.parentTransactionId,
      userId: child.userId,
      payload: serializeForPayload(child),
    }
    const { childTransactionId: _pk, ...updateSet } = row
    await this.db
      .insert(proratedChildTransactions)
      .values(row)
      .onConflictDoUpdate({
        target: proratedChildTransactions.childTransactionId,
        set: { ...updateSet, updatedAt: new Date() },
      })
  }
}
