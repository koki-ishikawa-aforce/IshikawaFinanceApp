import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { AccountIdSchema } from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'
import { BrokerageNameSchema } from '../value-objects/BrokerageName'

export const NisaContributionAddedSchema = DomainEventBaseSchema.extend({
  type: z.literal('NisaContributionAdded'),
  accountId: AccountIdSchema,
  addedAmount: MoneySchema,
  newAccumulated: MoneySchema,
  brokerageName: BrokerageNameSchema,
})
export type NisaContributionAdded = z.infer<typeof NisaContributionAddedSchema>
