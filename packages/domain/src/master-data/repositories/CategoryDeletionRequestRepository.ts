/**
 * カテゴリ削除リクエスト Repository I/F
 * @see docs/domain/08h-ul-マスタ管理.md §2
 */
import type { CategoryDeletionRequestId } from '../../shared/ids'
import type { CategoryDeletionRequest } from '../value-objects/CategoryDeletionRequest'

export interface CategoryDeletionRequestRepository {
  findById(id: CategoryDeletionRequestId): Promise<CategoryDeletionRequest | null>
  save(request: CategoryDeletionRequest): Promise<void>
}
