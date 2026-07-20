/**
 * consecutive_failure_counters テーブル（#17 の補助 VO、M-A で独立 Repository 化）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * PK = 複合 (ref_kind, ref_id)。FailureCounterRef（user / talk_room）を
 * 2 カラムに展開する（ref_id = userId または talkRoomId）。
 */
import { pgTable, text, timestamp, jsonb, check, primaryKey } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const consecutiveFailureCounters = pgTable(
  'consecutive_failure_counters',
  {
    refKind: text('ref_kind').notNull(),
    refId: text('ref_id').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  t => [
    primaryKey({ columns: [t.refKind, t.refId] }),
    check(
      'consecutive_failure_counters_ref_kind_check',
      sql`${t.refKind} IN ('user', 'talk_room')`,
    ),
  ],
)
