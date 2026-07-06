import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { FailureCounterRefSchema } from '../value-objects/ConsecutiveFailureCounter'

/** しきい値到達イベント（08g §3。フェイルセーフメール発火の起因、OQ-14） */
export const FailureThresholdReachedSchema = DomainEventBaseSchema.extend({
  type: z.literal('FailureThresholdReached'),
  counterRef: FailureCounterRefSchema,
  consecutiveFailureCount: z.number().int().positive(),
})
export type FailureThresholdReached = z.infer<typeof FailureThresholdReachedSchema>
