import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { UserIdSchema } from '../../shared/ids'
import { SpouseCompletionResultSchema } from '../value-objects/SpouseCompletionResult'

/** 配偶者完了検知イベント（08f §3、論点19: 画面ロード時のみ） */
export const SpouseCompletionDetectedSchema = DomainEventBaseSchema.extend({
  type: z.literal('SpouseCompletionDetected'),
  userId: UserIdSchema,
  result: SpouseCompletionResultSchema,
})
export type SpouseCompletionDetected = z.infer<typeof SpouseCompletionDetectedSchema>
