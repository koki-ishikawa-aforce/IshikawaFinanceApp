import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { DeliveryMessageIdSchema, UserIdSchema } from '../../shared/ids'

/** OAuth失効通知配信イベント（08g §3。個人 DM のみ、メールフェイルセーフ対象外 OQ-2 ✅） */
export const OauthRevocationNoticeDeliveredSchema = DomainEventBaseSchema.extend({
  type: z.literal('OauthRevocationNoticeDelivered'),
  deliveryMessageId: DeliveryMessageIdSchema,
  userId: UserIdSchema,
})
export type OauthRevocationNoticeDelivered = z.infer<typeof OauthRevocationNoticeDeliveredSchema>
