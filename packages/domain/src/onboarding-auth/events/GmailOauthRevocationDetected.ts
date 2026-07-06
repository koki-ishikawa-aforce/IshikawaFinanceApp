import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { UserIdSchema } from '../../shared/ids'

/**
 * Gmail_OAuth失効検知イベント（08f §3 / 08a §3）
 * OAuth ライフサイクルの所有者である本コンテキストで一元宣言する
 * （取引取込はこのイベントを購読してメール取込を停止する）。
 */
export const GmailOauthRevocationDetectedSchema = DomainEventBaseSchema.extend({
  type: z.literal('GmailOauthRevocationDetected'),
  userId: UserIdSchema,
  detectedAt: z.date(),
})
export type GmailOauthRevocationDetected = z.infer<typeof GmailOauthRevocationDetectedSchema>
