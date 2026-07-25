/**
 * shared_talk_rooms テーブル（共通トークルーム、世帯レベル）
 * @see docs/domain/08f-ul-オンボーディング認証.md §1
 * @see docs/domain/03-open-questions.md OQ-55 ①
 *
 * シングルトン: 共通トークルーム参加は「世帯にひとつの事実」であり、singleton は常に true
 * （CHECK）かつ UNIQUE のため 2 行目が入らない（phase0_configs と同一の型）。
 * 招待し直しによる別トークルームへの参加は、singleton 競合の UPDATE で置き換える。
 */
import { pgTable, text, boolean, timestamp, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const sharedTalkRooms = pgTable(
  'shared_talk_rooms',
  {
    talkRoomId: text('talk_room_id').primaryKey(),
    singleton: boolean('singleton').notNull().default(true).unique(),
    joinWebhookReceivedAt: timestamp('join_webhook_received_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  t => [check('shared_talk_rooms_singleton_check', sql`${t.singleton}`)],
)
