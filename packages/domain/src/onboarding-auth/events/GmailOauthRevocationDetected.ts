import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { UserIdSchema } from '../../shared/ids'

/**
 * Gmail_OAuth失効検知イベント（08f §3 / 08a §3）
 * OAuth ライフサイクルの所有者である本コンテキストで一元宣言する
 * （取引取込はこのイベントを購読してメール取込を停止する）。
 *
 * 配信契約（#392）: 失効の瞬間に 1 回だけでなく、**失効検知済みのあいだ日次バッチの
 * 実行ごとに元の検知日時のまま再発行される**（at-least-once）。失効通知の個人 DM が
 * 送信に失敗したときの再送機会を作るため。購読側は ユーザーID × 検知日時 で冪等に
 * 実装すること（1検知 = 1イベントを前提にすると二重処理になる）。
 */
export const GmailOauthRevocationDetectedSchema = DomainEventBaseSchema.extend({
  type: z.literal('GmailOauthRevocationDetected'),
  userId: UserIdSchema,
  detectedAt: z.date(),
})
export type GmailOauthRevocationDetected = z.infer<typeof GmailOauthRevocationDetectedSchema>
