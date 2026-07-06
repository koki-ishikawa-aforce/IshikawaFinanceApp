import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { TalkRoomIdSchema } from '../../shared/ids'

/** 通知機能有効化イベント（08f §3） */
export const NotificationActivatedSchema = DomainEventBaseSchema.extend({
  type: z.literal('NotificationActivated'),
  talkRoomId: TalkRoomIdSchema,
  activatedAt: z.date(),
})
export type NotificationActivated = z.infer<typeof NotificationActivatedSchema>
