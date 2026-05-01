/**
 * 口座集約の永続化 I/F
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §6.3
 */
import type { AccountId, UserId } from '../../shared/ids'
import type { Account } from '../aggregates/Account'

export interface AccountRepository {
  findById(id: AccountId): Promise<Account | null>
  findByOwner(ownerId: UserId): Promise<Account[]>
  /**
   * 集約の不変条件「同一ユーザー × 口座種別の一意性」は集約境界をまたぐため、
   * Repository.save 時の重複チェック方法は Phase 5 で確定する。
   */
  save(account: Account): Promise<void>
}
