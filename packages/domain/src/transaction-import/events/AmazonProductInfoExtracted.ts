import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { AmazonOrderIdSchema, UserIdSchema } from '../../shared/ids'
import { AmazonProductKeySchema } from '../../shared/value-objects/AmazonProductKey'

/** Amazon商品情報抽出イベント（08a §3） */
export const AmazonProductInfoExtractedSchema = DomainEventBaseSchema.extend({
  type: z.literal('AmazonProductInfoExtracted'),
  amazonOrderId: AmazonOrderIdSchema,
  userId: UserIdSchema,
  productKeys: z.array(AmazonProductKeySchema),
})
export type AmazonProductInfoExtracted = z.infer<typeof AmazonProductInfoExtractedSchema>
