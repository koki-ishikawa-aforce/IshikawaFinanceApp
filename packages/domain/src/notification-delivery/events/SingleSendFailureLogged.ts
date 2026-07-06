import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { DeliveryMessageIdSchema } from '../../shared/ids'
import { SendFailureReasonSchema } from '../aggregates/DeliveryMessage'

/** 単発失敗ログイベント（08g §3。単発失敗は完全スキップでログのみ、論点23） */
export const SingleSendFailureLoggedSchema = DomainEventBaseSchema.extend({
  type: z.literal('SingleSendFailureLogged'),
  deliveryMessageId: DeliveryMessageIdSchema,
  failureReason: SendFailureReasonSchema,
})
export type SingleSendFailureLogged = z.infer<typeof SingleSendFailureLoggedSchema>
