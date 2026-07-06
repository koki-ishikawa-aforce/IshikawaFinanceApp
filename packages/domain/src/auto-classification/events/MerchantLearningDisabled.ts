import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { UserIdSchema } from '../../shared/ids'

/** 加盟店学習が無効化されたイベント（08b §3、M-1） */
export const MerchantLearningDisabledSchema = DomainEventBaseSchema.extend({
  type: z.literal('MerchantLearningDisabled'),
  userId: UserIdSchema,
  merchantName: z.string().min(1),
})
export type MerchantLearningDisabled = z.infer<typeof MerchantLearningDisabledSchema>
