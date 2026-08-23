/**
 * household_notification_activations テーブル（世帯通知有効化記録、世帯レベル）
 * @see docs/domain/08f-ul-オンボーディング認証.md §1
 * @see docs/domain/03-open-questions.md OQ-55 ①（改訂 2026-08-23 / #447）
 *
 * シングルトン: 「世帯としてテストメッセージの送信を依頼した」は世帯にひとつの事実であり、
 * PK の singleton は常に true（CHECK）のため 2 行目が入らない（shared_talk_rooms と同じ形）。
 * 有効化日時は配信の冪等性キーの一部であり、記録後は書き換えない（ドメイン側で冪等）。
 */
import { pgTable, boolean, timestamp, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const householdNotificationActivations = pgTable(
  'household_notification_activations',
  {
    singleton: boolean('singleton').primaryKey().default(true),
    activatedAt: timestamp('activated_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  t => [check('household_notification_activations_singleton_check', sql`${t.singleton}`)],
)
