/**
 * 共通トークルーム（世帯レベル、08f §1「共通トークルーム参加状態」）
 * @see docs/domain/08f-ul-オンボーディング認証.md §1
 * @see docs/domain/03-open-questions.md OQ-55 ①
 *
 * 夫婦共通トークルームへの LINE 公式アカウント参加は「世帯にひとつの事実」であり、
 * join Webhook の source は userId を含まない。そのため参加状態は per-user の
 * LINE_運用設定 から分離し、世帯レベルの本集約 1 か所で保持する（OQ-55 ①）。
 * 通知配信（DeliveryTarget.shared_talk_room）・通知機能有効化が参照する「正」は本記録。
 *
 * 世帯は夫婦 2 人固定でありシングルトン（OQ-53 ②: 世帯ロスターは新設しない）。
 * 識別子を持たないため、Repository は引数なしで唯一の記録を読み書きする。
 */
import { z } from 'zod'
import { TalkRoomIdSchema } from '../../shared/ids'
import type { TalkRoomId } from '../../shared/ids'

export const SharedTalkRoomSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('not_joined') }),
  z.object({
    kind: z.literal('joined'),
    talkRoomId: TalkRoomIdSchema,
    joinWebhookReceivedAt: z.date(),
  }),
])
export type SharedTalkRoom = z.infer<typeof SharedTalkRoomSchema>

/** 未参加（記録が存在しない状態と同義） */
export const NOT_JOINED_SHARED_TALK_ROOM: SharedTalkRoom = { kind: 'not_joined' }

/**
 * 共通トークルーム参加を記録する（冪等: 同一トークルームに参加済みなら変更しない）。
 * 別トークルームIDでの参加は最新の記録で置き換える（招待し直しの再参加）。
 */
export function recordSharedTalkRoomJoined(
  room: SharedTalkRoom,
  talkRoomId: TalkRoomId,
  at: Date,
): SharedTalkRoom {
  if (room.kind === 'joined' && room.talkRoomId === talkRoomId) return room
  return SharedTalkRoomSchema.parse({
    kind: 'joined',
    talkRoomId,
    joinWebhookReceivedAt: at,
  })
}

/** 参加済みの共通トークルームID。未参加なら undefined */
export function joinedTalkRoomIdOf(room: SharedTalkRoom): TalkRoomId | undefined {
  return room.kind === 'joined' ? room.talkRoomId : undefined
}
