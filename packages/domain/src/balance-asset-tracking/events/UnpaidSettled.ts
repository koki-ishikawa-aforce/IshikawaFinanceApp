import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import {
  MitsuiSumitomoUnpaidIdSchema,
  UnpaidEntryIdSchema,
  SettlementNoticeIdSchema,
} from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'

export const UnpaidSettledSchema = DomainEventBaseSchema.extend({
  type: z.literal('UnpaidSettled'),
  unpaidAggregateId: MitsuiSumitomoUnpaidIdSchema,
  settledEntryIds: z.array(UnpaidEntryIdSchema),
  settlementNoticeId: SettlementNoticeIdSchema,
  settledTotal: MoneySchema,
})
export type UnpaidSettled = z.infer<typeof UnpaidSettledSchema>
