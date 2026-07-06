/**
 * アプリユーザー Repository I/F
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.4
 *
 * LINE_userID 一意性（OQ-15: userId = LINE userID）は save 前の findById で保証する（Phase 5 M-B）。
 */
import type { UserId } from '../../shared/ids'
import type { UserRole } from '../../shared/value-objects/UserRole'
import type { AppUser } from '../aggregates/AppUser'

export interface AppUserRepository {
  findById(id: UserId): Promise<AppUser | null>
  findByRole(role: UserRole): Promise<AppUser | null>
  save(user: AppUser): Promise<void>
}
