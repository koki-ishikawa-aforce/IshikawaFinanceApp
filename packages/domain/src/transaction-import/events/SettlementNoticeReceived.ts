import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import {
  MitsuiSumitomoUnpaidIdSchema,
  AccountIdSchema,
  SettlementNoticeIdSchema,
} from '../../shared/ids'

/**
 * トリガーイベント: 引落確定通知を受信した（08d §2 / OQ-53 4a）
 * 発行: メール取込バッチ(#35)。購読: 未払金消込・口座残高更新ハンドラー(#69)
 */
export const SettlementNoticeReceivedSchema = DomainEventBaseSchema.extend({
  type: z.literal('SettlementNoticeReceived'),
  unpaidAggregateId: MitsuiSumitomoUnpaidIdSchema,
  accountId: AccountIdSchema,
  settlementNoticeId: SettlementNoticeIdSchema,
})
export type SettlementNoticeReceived = z.infer<typeof SettlementNoticeReceivedSchema>
