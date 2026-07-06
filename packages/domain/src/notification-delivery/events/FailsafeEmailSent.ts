import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { FailsafeEmailIdSchema } from '../../shared/ids'

/** フェイルセーフメール送信イベント（08g §3） */
export const FailsafeEmailSentSchema = DomainEventBaseSchema.extend({
  type: z.literal('FailsafeEmailSent'),
  failsafeEmailId: FailsafeEmailIdSchema,
  toEmailAddress: z.string().email(),
})
export type FailsafeEmailSent = z.infer<typeof FailsafeEmailSentSchema>
