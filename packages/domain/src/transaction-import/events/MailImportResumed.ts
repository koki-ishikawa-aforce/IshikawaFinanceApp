import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { UserIdSchema } from '../../shared/ids'

/**
 * メール取込再開イベント（08a §3。Gmail 再認可完了後の取込再開）
 * Gmail_OAuth失効検知イベントは OAuth ライフサイクル所有者の
 * オンボーディング・認証コンテキスト（GmailOauthRevocationDetected）で宣言する。
 */
export const MailImportResumedSchema = DomainEventBaseSchema.extend({
  type: z.literal('MailImportResumed'),
  userId: UserIdSchema,
  resumedAt: z.date(),
})
export type MailImportResumed = z.infer<typeof MailImportResumedSchema>
