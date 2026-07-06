/**
 * カテゴリマスタ Repository I/F
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.5
 *
 * 名前一意性（同一スコープ内）は save 前の findAllVisibleToUser で保証する（Phase 5 M-B）。
 */
import type { CategoryId, UserId } from '../../shared/ids'
import type { CategoryMaster } from '../aggregates/CategoryMaster'

export interface CategoryMasterRepository {
  findById(id: CategoryId): Promise<CategoryMaster | null>
  /** 世帯共有 + 本人の個人別カテゴリを返す */
  findAllVisibleToUser(userId: UserId): Promise<CategoryMaster[]>
  save(category: CategoryMaster): Promise<void>
}
