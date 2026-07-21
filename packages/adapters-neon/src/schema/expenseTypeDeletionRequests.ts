/**
 * expense_type_deletion_requests テーブル（経費種別削除リクエスト）
 * @see docs/domain/08h-ul-マスタ管理.md §1
 *
 * category_deletion_requests と同構造。state_kind は payload.state.kind の昇格列。
 */
import { pgTable, text, timestamp, jsonb, check, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const expenseTypeDeletionRequests = pgTable(
  'expense_type_deletion_requests',
  {
    expenseTypeDeletionRequestId: text('expense_type_deletion_request_id').primaryKey(),
    requestedByUserId: text('requested_by_user_id').notNull(),
    targetExpenseTypeId: text('target_expense_type_id').notNull(),
    stateKind: text('state_kind').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  t => [
    check(
      'expense_type_deletion_requests_state_kind_check',
      sql`${t.stateKind} IN ('pending_remap', 'remap_requested', 'remap_completed', 'remap_failed')`,
    ),
    index('idx_expense_type_deletion_requests_target').on(t.targetExpenseTypeId),
  ],
)
