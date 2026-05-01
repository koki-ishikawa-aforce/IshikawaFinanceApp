import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import {
  MitsuiSumitomoUnpaidIdSchema,
  UnpaidEntryIdSchema,
  TransactionIdSchema,
} from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'

export const UnpaidBookkeptSchema = DomainEventBaseSchema.extend({
  type: z.literal('UnpaidBookkept'),
  unpaidAggregateId: MitsuiSumitomoUnpaidIdSchema,
  entryId: UnpaidEntryIdSchema,
  transactionId: TransactionIdSchema,
  bookedAmount: MoneySchema,
})
export type UnpaidBookkept = z.infer<typeof UnpaidBookkeptSchema>
