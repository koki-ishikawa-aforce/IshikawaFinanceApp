import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { ChildTransactionIdSchema, TransactionIdSchema } from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'
import { ProrationBasisSchema } from '../aggregates/ProratedChildTransaction'

/** 按分子取引派生イベント（08e §3） */
export const ProratedChildTransactionDerivedSchema = DomainEventBaseSchema.extend({
  type: z.literal('ProratedChildTransactionDerived'),
  childTransactionId: ChildTransactionIdSchema,
  parentTransactionId: TransactionIdSchema,
  personalAmount: MoneySchema,
  prorationBasis: ProrationBasisSchema,
})
export type ProratedChildTransactionDerived = z.infer<typeof ProratedChildTransactionDerivedSchema>
