/**
 * CategoryDeletionRequestRepository の PostgreSQL 実装
 * @see docs/domain/08h-ul-マスタ管理.md §2
 *
 * state_kind は payload.state.kind の昇格列。PK 以外の一意制約は持たない。
 */
import { eq } from 'drizzle-orm'
import type {
  CategoryDeletionRequest,
  CategoryDeletionRequestId,
  CategoryDeletionRequestRepository,
} from '@warimaru/domain'
import { CategoryDeletionRequestSchema } from '@warimaru/domain'
import type { Db } from '../client'
import { categoryDeletionRequests } from '../schema'
import { parsePayload, serializeForPayload } from '../serialize'

export class PostgresCategoryDeletionRequestRepository implements CategoryDeletionRequestRepository {
  constructor(private readonly db: Db) {}

  async findById(id: CategoryDeletionRequestId): Promise<CategoryDeletionRequest | null> {
    const rows = await this.db
      .select({ payload: categoryDeletionRequests.payload })
      .from(categoryDeletionRequests)
      .where(eq(categoryDeletionRequests.categoryDeletionRequestId, id))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return parsePayload(CategoryDeletionRequestSchema, row.payload)
  }

  async save(request: CategoryDeletionRequest): Promise<void> {
    const row = {
      categoryDeletionRequestId: request.categoryDeletionRequestId,
      requestedByUserId: request.requestedByUserId,
      targetCategoryId: request.targetCategoryId,
      stateKind: request.state.kind,
      payload: serializeForPayload(request),
    }
    const { categoryDeletionRequestId: _pk, ...updateSet } = row
    await this.db
      .insert(categoryDeletionRequests)
      .values(row)
      .onConflictDoUpdate({
        target: categoryDeletionRequests.categoryDeletionRequestId,
        set: { ...updateSet, updatedAt: new Date() },
      })
  }
}
