/**
 * category_deletion_requests テーブル（カテゴリ削除リクエスト）
 * @see docs/domain/08h-ul-マスタ管理.md §1
 *
 * リマップ状態機械（pending_remap → remap_requested → remap_completed | remap_failed）の
 * 記録。state_kind は payload.state.kind の昇格列。
 */
import { pgTable, text, timestamp, jsonb, check, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const categoryDeletionRequests = pgTable(
  'category_deletion_requests',
  {
    categoryDeletionRequestId: text('category_deletion_request_id').primaryKey(),
    requestedByUserId: text('requested_by_user_id').notNull(),
    targetCategoryId: text('target_category_id').notNull(),
    stateKind: text('state_kind').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  t => [
    check(
      'category_deletion_requests_state_kind_check',
      sql`${t.stateKind} IN ('pending_remap', 'remap_requested', 'remap_completed', 'remap_failed')`,
    ),
    index('idx_category_deletion_requests_target').on(t.targetCategoryId),
  ],
)
