import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { UserIdSchema } from '../../shared/ids'
import { AmazonProductKeySchema } from '../../shared/value-objects/AmazonProductKey'

/** Amazon商品キーマッピングが登録されたイベント（08b §3、X-1） */
export const AmazonProductKeyMappingRegisteredSchema = DomainEventBaseSchema.extend({
  type: z.literal('AmazonProductKeyMappingRegistered'),
  userId: UserIdSchema,
  amazonProductKey: AmazonProductKeySchema,
})
export type AmazonProductKeyMappingRegistered = z.infer<
  typeof AmazonProductKeyMappingRegisteredSchema
>
