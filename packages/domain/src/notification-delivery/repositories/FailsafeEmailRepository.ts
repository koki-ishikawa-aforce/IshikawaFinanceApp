/**
 * フェイルセーフメール Repository I/F
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.6
 */
import type { FailsafeEmailId } from '../../shared/ids'
import type { FailsafeEmail } from '../aggregates/FailsafeEmail'

export interface FailsafeEmailRepository {
  findById(id: FailsafeEmailId): Promise<FailsafeEmail | null>
  save(email: FailsafeEmail): Promise<void>
}
