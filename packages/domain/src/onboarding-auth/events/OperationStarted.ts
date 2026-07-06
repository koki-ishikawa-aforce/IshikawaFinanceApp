import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { UserIdSchema } from '../../shared/ids'

/** 運用開始イベント（08f §3。両者完了済みでのみ発火、論点16） */
export const OperationStartedSchema = DomainEventBaseSchema.extend({
  type: z.literal('OperationStarted'),
  honeyUserId: UserIdSchema,
  darlingUserId: UserIdSchema,
  operationStartedAt: z.date(),
})
export type OperationStarted = z.infer<typeof OperationStartedSchema>
