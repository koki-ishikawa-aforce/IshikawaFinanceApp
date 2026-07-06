/**
 * 按分子取引 Repository I/F
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.2
 */
import type { ChildTransactionId, TransactionId } from '../../shared/ids'
import type { ProratedChildTransaction } from '../aggregates/ProratedChildTransaction'

export interface ProratedChildTransactionRepository {
  findById(id: ChildTransactionId): Promise<ProratedChildTransaction | null>
  findByParent(parentTransactionId: TransactionId): Promise<ProratedChildTransaction[]>
  save(child: ProratedChildTransaction): Promise<void>
}
