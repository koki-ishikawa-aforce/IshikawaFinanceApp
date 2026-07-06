import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { UserIdSchema } from '../../shared/ids'

/** 加盟店学習が再有効化されたイベント（08b §3） */
export const MerchantLearningReenabledSchema = DomainEventBaseSchema.extend({
  type: z.literal('MerchantLearningReenabled'),
  userId: UserIdSchema,
  merchantName: z.string().min(1),
})
export type MerchantLearningReenabled = z.infer<typeof MerchantLearningReenabledSchema>
