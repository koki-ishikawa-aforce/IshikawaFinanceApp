/**
 * transaction_candidates テーブル（集約 #1 取引候補）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * - occurred_on は occurred_at の JST 暦日への導出昇格（date 型）。
 *   三項一致 findByTripleMatch（OQ-7 / OQ-23）は「発生日」比較のため、
 *   save 時と検索時に同じ dateToJstCalendarDate 変換を適用する
 * - gmail_message_id は importSource union の 2 箇所から昇格:
 *   kind='email' の gmailMessageId と kind='amazon_match' の smbcGmailMessageId。
 *   normal 候補が Amazon 突合済みへ遷移しても同一 SMBC メールの重複除外
 *   （partial unique）が効き続けるため
 */
import {
  pgTable,
  text,
  integer,
  date,
  timestamp,
  jsonb,
  check,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const transactionCandidates = pgTable(
  'transaction_candidates',
  {
    transactionCandidateId: text('transaction_candidate_id').primaryKey(),
    userId: text('user_id').notNull(),
    kind: text('kind').notNull(),
    merchantName: text('merchant_name').notNull(),
    amount: integer('amount').notNull(),
    occurredOn: date('occurred_on', { mode: 'string' }).notNull(),
    gmailMessageId: text('gmail_message_id'),
    payload: jsonb('payload').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  t => [
    check(
      'transaction_candidates_kind_check',
      sql`${t.kind} IN ('normal', 'amazon_matched', 'match_timeout', 'confirmed')`,
    ),
    // メール重複除外（Gmail message ID 完全一致）
    uniqueIndex('idx_transaction_candidates_gmail_unique')
      .on(t.gmailMessageId)
      .where(sql`${t.gmailMessageId} IS NOT NULL`),
    // 三項一致 findByTripleMatch(userId, occurredOn, amount, merchantName)
    index('idx_transaction_candidates_triple').on(t.userId, t.occurredOn, t.amount, t.merchantName),
    // Amazon 突合 findEmailSourcedNormalCandidates(userId, kind, occurredOn の範囲)。
    // 三項一致の索引は 2 列目が occurred_on の等価比較向けで、kind で絞る範囲検索には効かない
    index('idx_transaction_candidates_user_kind_occurred').on(t.userId, t.kind, t.occurredOn),
  ],
)
