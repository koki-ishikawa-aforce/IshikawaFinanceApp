import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { TalkRoomIdSchema } from '../../shared/ids'

/** LINE 共通トークルーム参加イベント（08f §3。join webhook 受信） */
export const LineTalkRoomJoinedSchema = DomainEventBaseSchema.extend({
  type: z.literal('LineTalkRoomJoined'),
  talkRoomId: TalkRoomIdSchema,
  receivedAt: z.date(),
})
export type LineTalkRoomJoined = z.infer<typeof LineTalkRoomJoinedSchema>
