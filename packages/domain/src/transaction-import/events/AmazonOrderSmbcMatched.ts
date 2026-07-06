import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { AmazonOrderIdSchema, GmailMessageIdSchema } from '../../shared/ids'

/** Amazon注文SMBC突合イベント（08a §3） */
export const AmazonOrderSmbcMatchedSchema = DomainEventBaseSchema.extend({
  type: z.literal('AmazonOrderSmbcMatched'),
  amazonOrderId: AmazonOrderIdSchema,
  smbcGmailMessageId: GmailMessageIdSchema,
})
export type AmazonOrderSmbcMatched = z.infer<typeof AmazonOrderSmbcMatchedSchema>
