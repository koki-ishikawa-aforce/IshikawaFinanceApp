/**
 * phase0_configs テーブル（集約 #21 Phase0 設定値）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §5
 *
 * シングルトン: singleton は常に true（CHECK）かつ UNIQUE のため 2 行目が入らない。
 * 設定値実体は Parameter Store にあり、payload はパス参照のみ保持する（OQ-27）。
 */
import { pgTable, text, boolean, timestamp, jsonb, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const phase0Configs = pgTable(
  'phase0_configs',
  {
    phase0ConfigId: text('phase0_config_id').primaryKey(),
    singleton: boolean('singleton').notNull().default(true).unique(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  t => [check('phase0_configs_singleton_check', sql`${t.singleton}`)],
)
