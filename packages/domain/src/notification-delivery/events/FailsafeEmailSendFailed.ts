import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { FailsafeEmailIdSchema } from '../../shared/ids'
import { EmailSendFailureReasonSchema } from '../aggregates/FailsafeEmail'

/** フェイルセーフ送信失敗イベント（08g §3） */
export const FailsafeEmailSendFailedSchema = DomainEventBaseSchema.extend({
  type: z.literal('FailsafeEmailSendFailed'),
  failsafeEmailId: FailsafeEmailIdSchema,
  failureReason: EmailSendFailureReasonSchema,
})
export type FailsafeEmailSendFailed = z.infer<typeof FailsafeEmailSendFailedSchema>
