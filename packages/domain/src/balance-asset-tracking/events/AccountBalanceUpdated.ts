import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { AccountIdSchema } from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'

export const AccountBalanceUpdatedSchema = DomainEventBaseSchema.extend({
  type: z.literal('AccountBalanceUpdated'),
  accountId: AccountIdSchema,
  delta: MoneySchema,
  newBalance: MoneySchema,
})
export type AccountBalanceUpdated = z.infer<typeof AccountBalanceUpdatedSchema>
