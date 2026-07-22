/**
 * 配信メッセージ集約（通知配信コンテキスト）
 * @see docs/domain/08g-ul-通知配信.md §1
 * @see docs/domain/09-aggregates.md #15
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.6
 *
 * kawasima: data 配信メッセージ = 送信予約済み OR 送信中 OR 送信成功 OR 送信失敗 OR 送信スキップ
 *
 * 不変条件:
 *  - 配信先が確定済みでなければ送信処理に進まない（送信スキップ理由 target_unresolved）
 *  - 送信成功・送信スキップは最終状態（再送信不可、終端からの遷移関数を提供しない）
 *  - 配信用途 × 配信先の整合（個人サマリ・OAuth失効 ⇒ 個人DM、
 *    リマインダー・世帯サマリ・テスト ⇒ 共通トークルーム）を superRefine で強制
 */
import { z } from 'zod'
import { DeliveryMessageIdSchema, LineMessageIdSchema, type LineMessageId } from '../../shared/ids'
import { DeliveryTargetSchema } from '../value-objects/DeliveryTarget'
import { DeliveryContentSchema } from '../value-objects/DeliveryContent'
import { DeliveryPurposeSchema, type DeliveryPurpose } from '../value-objects/DeliveryPurpose'

export const SendFailureReasonSchema = z.enum(['line_api_failure', 'timeout', 'invalid_target'])
export type SendFailureReason = z.infer<typeof SendFailureReasonSchema>

export const DeliveryRetryStateSchema = z.enum(['retry_scheduled', 'retry_abandoned'])
export type DeliveryRetryState = z.infer<typeof DeliveryRetryStateSchema>

export const DeliverySkipReasonSchema = z.enum([
  'reminder_stop_condition_met',
  'notification_disabled',
  'target_unresolved',
])
export type DeliverySkipReason = z.infer<typeof DeliverySkipReasonSchema>

/** 共通属性 */
export const CommonDeliveryMessageAttrsSchema = z.object({
  deliveryMessageId: DeliveryMessageIdSchema,
  target: DeliveryTargetSchema,
  content: DeliveryContentSchema,
  purpose: DeliveryPurposeSchema,
})
export type CommonDeliveryMessageAttrs = z.infer<typeof CommonDeliveryMessageAttrsSchema>

/** 配信用途 → 要求される配信先種別 */
const REQUIRED_TARGET_KIND: Record<DeliveryPurpose, 'shared_talk_room' | 'personal_dm'> = {
  csv_import_reminder: 'shared_talk_room',
  monthly_report_household_summary: 'shared_talk_room',
  monthly_report_personal_summary: 'personal_dm',
  oauth_revocation_notice: 'personal_dm',
  test_message: 'shared_talk_room',
}

export const DeliveryMessageSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('reserved'),
      common: CommonDeliveryMessageAttrsSchema,
      reservedAt: z.date(),
    }),
    z.object({
      kind: z.literal('sending'),
      common: CommonDeliveryMessageAttrsSchema,
      sendStartedAt: z.date(),
    }),
    z.object({
      kind: z.literal('sent'),
      common: CommonDeliveryMessageAttrsSchema,
      sentAt: z.date(),
      lineMessageId: LineMessageIdSchema,
    }),
    z.object({
      kind: z.literal('failed'),
      common: CommonDeliveryMessageAttrsSchema,
      failedAt: z.date(),
      failureReason: SendFailureReasonSchema,
      retryState: DeliveryRetryStateSchema,
    }),
    z.object({
      kind: z.literal('skipped'),
      common: CommonDeliveryMessageAttrsSchema,
      skippedAt: z.date(),
      skipReason: DeliverySkipReasonSchema,
    }),
  ])
  .superRefine((message, ctx) => {
    const required = REQUIRED_TARGET_KIND[message.common.purpose]
    if (message.common.target.kind !== required) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `配信用途 ${message.common.purpose} の配信先は ${required} でなければならない`,
        path: ['common', 'target'],
      })
    }
  })
export type DeliveryMessage = z.infer<typeof DeliveryMessageSchema>

export type ReservedDeliveryMessage = Extract<DeliveryMessage, { kind: 'reserved' }>
export type SendingDeliveryMessage = Extract<DeliveryMessage, { kind: 'sending' }>
export type SentDeliveryMessage = Extract<DeliveryMessage, { kind: 'sent' }>
export type FailedDeliveryMessage = Extract<DeliveryMessage, { kind: 'failed' }>
export type SkippedDeliveryMessage = Extract<DeliveryMessage, { kind: 'skipped' }>

/**
 * 配信メッセージを予約する（08g §2「配信メッセージを予約する」）。
 * 配信用途 × 配信先の整合は schema の superRefine が強制する。
 */
export function reserveDeliveryMessage(
  common: CommonDeliveryMessageAttrs,
  at: Date,
): ReservedDeliveryMessage {
  return DeliveryMessageSchema.parse({
    kind: 'reserved',
    common,
    reservedAt: at,
  }) as ReservedDeliveryMessage
}

/** 状態遷移: 送信予約済み → 送信中 */
export function startSendingMessage(
  message: ReservedDeliveryMessage,
  at: Date,
): SendingDeliveryMessage {
  return DeliveryMessageSchema.parse({
    kind: 'sending',
    common: message.common,
    sendStartedAt: at,
  }) as SendingDeliveryMessage
}

/** 状態遷移: 送信中 → 送信成功（終端） */
export function markMessageSent(
  message: SendingDeliveryMessage,
  lineMessageId: LineMessageId,
  at: Date,
): SentDeliveryMessage {
  return DeliveryMessageSchema.parse({
    kind: 'sent',
    common: message.common,
    sentAt: at,
    lineMessageId,
  }) as SentDeliveryMessage
}

/** 状態遷移: 送信中 → 送信失敗 */
export function markMessageSendFailed(
  message: SendingDeliveryMessage,
  failureReason: SendFailureReason,
  retryState: DeliveryRetryState,
  at: Date,
): FailedDeliveryMessage {
  return DeliveryMessageSchema.parse({
    kind: 'failed',
    common: message.common,
    failedAt: at,
    failureReason,
    retryState,
  }) as FailedDeliveryMessage
}

/** 状態遷移: 送信予約済み → 送信スキップ（終端） */
export function skipDeliveryMessage(
  message: ReservedDeliveryMessage,
  skipReason: DeliverySkipReason,
  at: Date,
): SkippedDeliveryMessage {
  return DeliveryMessageSchema.parse({
    kind: 'skipped',
    common: message.common,
    skippedAt: at,
    skipReason,
  }) as SkippedDeliveryMessage
}
