/**
 * フェイルセーフメール集約（通知配信コンテキスト）
 * @see docs/domain/08g-ul-通知配信.md §1
 * @see docs/domain/09-aggregates.md #17
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.6
 *
 * kawasima: data フェイルセーフメール = 送信予約済み OR 送信中 OR 送信成功 OR 送信失敗
 *
 * 不変条件:
 *  - しきい値到達済みの連続失敗カウンタがある場合のみ生成される（起因参照を必須で構造表現）
 *  - 送信成功は最終状態（再送信不可、終端からの遷移関数を提供しない）
 *  - OAuth失効通知はメールフェイルセーフの対象外（OQ-2 ✅: 個人 DM のみ）
 */
import { z } from 'zod'
import { FailsafeEmailIdSchema } from '../../shared/ids'
import { FailureCounterRefSchema } from '../value-objects/ConsecutiveFailureCounter'

export const EmailSendFailureReasonSchema = z.enum(['smtp_failure', 'ses_failure', 'timeout'])
export type EmailSendFailureReason = z.infer<typeof EmailSendFailureReasonSchema>

/** 共通属性 */
export const CommonFailsafeEmailAttrsSchema = z.object({
  failsafeEmailId: FailsafeEmailIdSchema,
  toEmailAddress: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1),
  causingCounterRef: FailureCounterRefSchema,
})
export type CommonFailsafeEmailAttrs = z.infer<typeof CommonFailsafeEmailAttrsSchema>

export const FailsafeEmailSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('reserved'),
    common: CommonFailsafeEmailAttrsSchema,
    reservedAt: z.date(),
  }),
  z.object({
    kind: z.literal('sending'),
    common: CommonFailsafeEmailAttrsSchema,
    sendStartedAt: z.date(),
  }),
  z.object({
    kind: z.literal('sent'),
    common: CommonFailsafeEmailAttrsSchema,
    sentAt: z.date(),
    providerRef: z.string().min(1),
  }),
  z.object({
    kind: z.literal('failed'),
    common: CommonFailsafeEmailAttrsSchema,
    failedAt: z.date(),
    failureReason: EmailSendFailureReasonSchema,
  }),
])
export type FailsafeEmail = z.infer<typeof FailsafeEmailSchema>

export type ReservedFailsafeEmail = Extract<FailsafeEmail, { kind: 'reserved' }>
export type SendingFailsafeEmail = Extract<FailsafeEmail, { kind: 'sending' }>
export type SentFailsafeEmail = Extract<FailsafeEmail, { kind: 'sent' }>
export type FailedFailsafeEmail = Extract<FailsafeEmail, { kind: 'failed' }>

/** 状態遷移: 送信予約済み → 送信中 */
export function startSendingFailsafeEmail(
  email: ReservedFailsafeEmail,
  at: Date,
): SendingFailsafeEmail {
  return FailsafeEmailSchema.parse({
    kind: 'sending',
    common: email.common,
    sendStartedAt: at,
  }) as SendingFailsafeEmail
}

/** 状態遷移: 送信中 → 送信成功（終端） */
export function markFailsafeEmailSent(
  email: SendingFailsafeEmail,
  providerRef: string,
  at: Date,
): SentFailsafeEmail {
  return FailsafeEmailSchema.parse({
    kind: 'sent',
    common: email.common,
    sentAt: at,
    providerRef,
  }) as SentFailsafeEmail
}

/** 状態遷移: 送信中 → 送信失敗 */
export function markFailsafeEmailFailed(
  email: SendingFailsafeEmail,
  failureReason: EmailSendFailureReason,
  at: Date,
): FailedFailsafeEmail {
  return FailsafeEmailSchema.parse({
    kind: 'failed',
    common: email.common,
    failedAt: at,
    failureReason,
  }) as FailedFailsafeEmail
}
