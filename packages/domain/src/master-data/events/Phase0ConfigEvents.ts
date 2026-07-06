import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { Phase0ConfigIdSchema } from '../../shared/ids'

/** LINE_Channel設定投入イベント（08h §3） */
export const LineChannelConfigInsertedSchema = DomainEventBaseSchema.extend({
  type: z.literal('LineChannelConfigInserted'),
  phase0ConfigId: Phase0ConfigIdSchema,
})
export type LineChannelConfigInserted = z.infer<typeof LineChannelConfigInsertedSchema>

/** LINE_Webhook設定イベント（08h §3） */
export const LineWebhookConfiguredSchema = DomainEventBaseSchema.extend({
  type: z.literal('LineWebhookConfigured'),
  phase0ConfigId: Phase0ConfigIdSchema,
})
export type LineWebhookConfigured = z.infer<typeof LineWebhookConfiguredSchema>

/** 許可リスト投入イベント（08h §3） */
export const AllowlistInsertedSchema = DomainEventBaseSchema.extend({
  type: z.literal('AllowlistInserted'),
  phase0ConfigId: Phase0ConfigIdSchema,
})
export type AllowlistInserted = z.infer<typeof AllowlistInsertedSchema>

/** LINE公式アカウント作成イベント（08h §3） */
export const LineOfficialAccountCreatedSchema = DomainEventBaseSchema.extend({
  type: z.literal('LineOfficialAccountCreated'),
  officialAccountIdentifier: z.string().min(1),
})
export type LineOfficialAccountCreated = z.infer<typeof LineOfficialAccountCreatedSchema>
