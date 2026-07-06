import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { UserIdSchema } from '../../shared/ids'
import { LearningAxisSchema } from '../value-objects/LearningAxis'

/** 学習データが更新されたイベント（08b §3。T-2: 修正された軸のみ更新） */
export const LearningRuleUpdatedSchema = DomainEventBaseSchema.extend({
  type: z.literal('LearningRuleUpdated'),
  userId: UserIdSchema,
  merchantName: z.string().min(1),
  axis: LearningAxisSchema,
})
export type LearningRuleUpdated = z.infer<typeof LearningRuleUpdatedSchema>
