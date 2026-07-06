import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { GmailMessageIdSchema } from '../../shared/ids'
import { MailParseFailureReasonSchema } from '../value-objects/SmbcMailParseResult'

/** メールパース失敗イベント（08a §3。パース失敗時は取引候補が生成されない） */
export const MailParseFailedSchema = DomainEventBaseSchema.extend({
  type: z.literal('MailParseFailed'),
  gmailMessageId: GmailMessageIdSchema,
  reason: MailParseFailureReasonSchema,
})
export type MailParseFailed = z.infer<typeof MailParseFailedSchema>
