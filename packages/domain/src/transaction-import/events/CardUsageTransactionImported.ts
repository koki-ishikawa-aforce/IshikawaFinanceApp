import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import {
  MitsuiSumitomoUnpaidIdSchema,
  AccountIdSchema,
  TransactionIdSchema,
} from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'

/**
 * トリガーイベント: カード利用取引を取り込んだ（08d §2 / OQ-53 4a）
 * 発行: メール取込バッチ(#35)。購読: 未払金計上ハンドラー(#69)
 */
export const CardUsageTransactionImportedSchema = DomainEventBaseSchema.extend({
  type: z.literal('CardUsageTransactionImported'),
  unpaidAggregateId: MitsuiSumitomoUnpaidIdSchema,
  accountId: AccountIdSchema,
  transactionId: TransactionIdSchema,
  amount: MoneySchema,
})
export type CardUsageTransactionImported = z.infer<typeof CardUsageTransactionImportedSchema>
