/**
 * 経費種別削除リクエスト Repository I/F
 * @see docs/domain/08h-ul-マスタ管理.md §2
 */
import type { ExpenseTypeDeletionRequestId } from '../../shared/ids'
import type { ExpenseTypeDeletionRequest } from '../value-objects/ExpenseTypeDeletionRequest'

export interface ExpenseTypeDeletionRequestRepository {
  findById(id: ExpenseTypeDeletionRequestId): Promise<ExpenseTypeDeletionRequest | null>
  save(request: ExpenseTypeDeletionRequest): Promise<void>
}
