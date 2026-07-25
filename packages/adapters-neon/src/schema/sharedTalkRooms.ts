/**
 * shared_talk_rooms テーブル（共通トークルーム、世帯レベル）
 * @see docs/domain/08f-ul-オンボーディング認証.md §1
 * @see docs/domain/03-open-questions.md OQ-55 ①
 *
 * シングルトン: 共通トークルーム参加は「世帯にひとつの事実」であり、PK の singleton は
 * 常に true（CHECK）のため 2 行目が入らない。招待し直しによる別トークルームへの参加は
 * talk_room_id の UPDATE で置き換える（phase0_configs と異なり共通トークルームIDは
 * 外部由来かつ差し替わるため、PK には据えない）。
 */
import { pgTable, text, boolean, timestamp, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const sharedTalkRooms = pgTable(
  'shared_talk_rooms',
  {
    singleton: boolean('singleton').primaryKey().default(true),
    talkRoomId: text('talk_room_id').notNull(),
    joinWebhookReceivedAt: timestamp('join_webhook_received_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  t => [check('shared_talk_rooms_singleton_check', sql`${t.singleton}`)],
)
