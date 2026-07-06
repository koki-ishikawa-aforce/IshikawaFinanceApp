/**
 * accounts テーブル（集約 #9 口座）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §4.3
 *
 * UNIQUE (owner_user_id, kind): Phase 4 spec §6.3 で保留していた
 * 集約横断の一意性を DB が最終保証する（M-B spec §2.2）。
 */
import { pgTable, text, boolean, timestamp, jsonb, check, unique } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const accounts = pgTable(
  'accounts',
  {
    accountId: text('account_id').primaryKey(),
    ownerUserId: text('owner_user_id').notNull(),
    kind: text('kind').notNull(),
    isActive: boolean('is_active').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  t => [
    check(
      'accounts_kind_check',
      sql`${t.kind} IN ('smbc_bank', 'mitsui_sumitomo_card', 'other_savings', 'nisa')`,
    ),
    unique('accounts_owner_user_id_kind_unique').on(t.ownerUserId, t.kind),
  ],
)
