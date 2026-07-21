/**
 * 経費種別マスタ Repository I/F
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.5
 */
import type { ExpenseTypeId, UserId } from '../../shared/ids'
import type { ExpenseTypeMaster } from '../aggregates/ExpenseTypeMaster'

export interface ExpenseTypeMasterRepository {
  findById(id: ExpenseTypeId): Promise<ExpenseTypeMaster | null>
  /** 世帯共有 + 本人の個人別経費種別を返す */
  findAllVisibleToUser(userId: UserId): Promise<ExpenseTypeMaster[]>
  save(expenseType: ExpenseTypeMaster): Promise<void>
  /** 追加経費種別の物理削除（規定経費種別の削除可否は呼び出し側で検査する） */
  deleteById(id: ExpenseTypeId): Promise<void>
}
