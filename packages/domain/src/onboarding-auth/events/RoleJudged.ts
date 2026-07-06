import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { UserIdSchema } from '../../shared/ids'
import { RoleJudgmentSchema } from '../value-objects/RoleJudgment'

/** 役割判定イベント（08f §3） */
export const RoleJudgedSchema = DomainEventBaseSchema.extend({
  type: z.literal('RoleJudged'),
  lineUserId: UserIdSchema,
  result: RoleJudgmentSchema,
})
export type RoleJudged = z.infer<typeof RoleJudgedSchema>
