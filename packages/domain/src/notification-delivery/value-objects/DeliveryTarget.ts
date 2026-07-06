import { z } from 'zod'
import { TalkRoomIdSchema, UserIdSchema } from '../../shared/ids'

/**
 * 配信先（共通トークルーム OR 個人DM）
 * @see docs/domain/08g-ul-通知配信.md §1
 */
export const DeliveryTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('shared_talk_room'), talkRoomId: TalkRoomIdSchema }),
  z.object({ kind: z.literal('personal_dm'), userId: UserIdSchema }),
])
export type DeliveryTarget = z.infer<typeof DeliveryTargetSchema>
