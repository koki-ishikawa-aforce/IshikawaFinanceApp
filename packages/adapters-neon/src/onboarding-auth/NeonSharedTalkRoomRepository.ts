/**
 * SharedTalkRoomRepository の Neon 実装（世帯で 1 件、OQ-55 ①）
 * @see docs/domain/08f-ul-オンボーディング認証.md §1
 *
 * 行が無い = 未参加。参加記録は singleton カラム（UNIQUE + CHECK）の競合で UPDATE し、
 * 招待し直しによる別トークルームへの差し替えも 1 行のまま保つ。
 */
import type { SharedTalkRoom, SharedTalkRoomRepository } from '@warimaru/domain'
import { NOT_JOINED_SHARED_TALK_ROOM, SharedTalkRoomSchema } from '@warimaru/domain'
import type { Db } from '../client'
import { sharedTalkRooms } from '../schema'

export class NeonSharedTalkRoomRepository implements SharedTalkRoomRepository {
  constructor(private readonly db: Db) {}

  async find(): Promise<SharedTalkRoom> {
    // singleton UNIQUE により 0..1 行
    const rows = await this.db
      .select({
        talkRoomId: sharedTalkRooms.talkRoomId,
        joinWebhookReceivedAt: sharedTalkRooms.joinWebhookReceivedAt,
      })
      .from(sharedTalkRooms)
      .limit(1)
    const row = rows[0]
    if (row === undefined) return NOT_JOINED_SHARED_TALK_ROOM
    return SharedTalkRoomSchema.parse({
      kind: 'joined',
      talkRoomId: row.talkRoomId,
      joinWebhookReceivedAt: row.joinWebhookReceivedAt,
    })
  }

  async save(room: SharedTalkRoom): Promise<void> {
    // 未参加は「記録が無い」と同義。参加記録の取り消し要件は無いため削除は行わない
    if (room.kind !== 'joined') return
    await this.db
      .insert(sharedTalkRooms)
      .values({
        talkRoomId: room.talkRoomId,
        joinWebhookReceivedAt: room.joinWebhookReceivedAt,
      })
      .onConflictDoUpdate({
        target: sharedTalkRooms.singleton,
        set: {
          talkRoomId: room.talkRoomId,
          joinWebhookReceivedAt: room.joinWebhookReceivedAt,
          updatedAt: new Date(),
        },
      })
  }
}
