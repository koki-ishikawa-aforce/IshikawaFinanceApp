import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { DeliveryLogIdSchema, DeliveryMessageIdSchema } from '../../shared/ids'

/** 配信ログ保存イベント（08g §3） */
export const DeliveryLogSavedSchema = DomainEventBaseSchema.extend({
  type: z.literal('DeliveryLogSaved'),
  deliveryLogId: DeliveryLogIdSchema,
  deliveryMessageId: DeliveryMessageIdSchema,
  status: z.enum(['success', 'failure', 'skipped']),
})
export type DeliveryLogSaved = z.infer<typeof DeliveryLogSavedSchema>
