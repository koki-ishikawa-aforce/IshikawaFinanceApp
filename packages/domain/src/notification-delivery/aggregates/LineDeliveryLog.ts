/**
 * LINE配信ログ集約（通知配信コンテキスト）
 * @see docs/domain/08g-ul-通知配信.md §1
 * @see docs/domain/09-aggregates.md #16
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.6
 *
 * kawasima: data LINE配信ログ = 配信ログID AND 配信メッセージID AND 配信タイミング種別 AND
 *   配信先 AND 送信payload_json AND 送信結果ステータス AND 送信日時 AND 冪等性キー
 *
 * 不変条件:
 *  - 冪等性キーで同月レポート再送信の重複を防ぐ（同一冪等性キーで配信確定ログは 1 件のみ、
 *    concludesDelivery と Repository.findAllByIdempotencyKey で保証、Phase 5 M-B）
 *  - 送信失敗のログは配信を確定させない（同一冪等性キーで再送信できる。#441-A。
 *    月次レポートサマリは月に 1 通しか送る機会が無く、1 回の失敗で永久に届かなくなるため）
 *  - 送信完了後のログは変更不可（監査記録。遷移関数を一切提供しない。再送信は
 *    新しい配信メッセージ・新しいログとして積まれ、失敗ログは履歴として残る）
 *  - 送信日時は送信結果ステータス内でのみ保持する（success.sentAt / failure.failedAt /
 *    skipped.skippedAt。skipped は送信が発生しないため、集約直下に送信日時を持たない）
 *
 * スナップショット廃止（OQ-3 撤回）の代替として配信時点の値を凍結する（OQ-34）。
 */
import { z } from 'zod'
import {
  DeliveryLogIdSchema,
  DeliveryMessageIdSchema,
  LineMessageIdSchema,
  type DeliveryLogId,
} from '../../shared/ids'
import { DeliveryTargetSchema } from '../value-objects/DeliveryTarget'
import type { DeliveryPurpose } from '../value-objects/DeliveryPurpose'
import {
  SendFailureReasonSchema,
  DeliverySkipReasonSchema,
  type SentDeliveryMessage,
  type FailedDeliveryMessage,
  type SkippedDeliveryMessage,
} from './DeliveryMessage'

export const DeliveryTimingKindSchema = z.enum([
  'reminder',
  'csv_confirmation',
  'oauth_revocation_detected',
  'test_send',
])
export type DeliveryTimingKind = z.infer<typeof DeliveryTimingKindSchema>

export const DeliveryResultStatusSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('success'), lineMessageId: LineMessageIdSchema, sentAt: z.date() }),
  z.object({
    kind: z.literal('failure'),
    failureReason: SendFailureReasonSchema,
    failedAt: z.date(),
  }),
  z.object({
    kind: z.literal('skipped'),
    skipReason: DeliverySkipReasonSchema,
    skippedAt: z.date(),
  }),
])
export type DeliveryResultStatus = z.infer<typeof DeliveryResultStatusSchema>

export const LineDeliveryLogSchema = z.object({
  deliveryLogId: DeliveryLogIdSchema,
  deliveryMessageId: DeliveryMessageIdSchema,
  timingKind: DeliveryTimingKindSchema,
  target: DeliveryTargetSchema,
  sentPayloadJson: z.string().min(1),
  resultStatus: DeliveryResultStatusSchema,
  idempotencyKey: z.string().min(1),
})
export type LineDeliveryLog = z.infer<typeof LineDeliveryLogSchema>

/** 配信用途 → 配信タイミング種別（08g §1 の両語彙の対応。月次サマリは CSV 確定昇格で配信される） */
const TIMING_KIND_BY_PURPOSE: Record<DeliveryPurpose, DeliveryTimingKind> = {
  csv_import_reminder: 'reminder',
  monthly_report_household_summary: 'csv_confirmation',
  monthly_report_personal_summary: 'csv_confirmation',
  oauth_revocation_notice: 'oauth_revocation_detected',
  test_message: 'test_send',
}

/**
 * この配信ログが冪等性キーの配信を確定させるか（08g §2「LINE 配信ログを保存する」）。
 *
 * 成功・スキップは確定（同一キーでの再送信を止める終端）。送信失敗は確定させない
 * ため、同じ冪等性キーの配信は次の機会に改めて試行される（#441-A）。
 *
 * 「確定したログが同一キーで 1 件だけ」は本関数が唯一の判定元で、adapter 側の
 * partial unique index は最終保証にすぎない（判定を再実装しない）。
 */
export function concludesDelivery(log: LineDeliveryLog): boolean {
  return log.resultStatus.kind !== 'failure'
}

/**
 * 送信処理の終端状態から配信ログを組み立てる（08g §2「LINE 配信ログを保存する」）。
 * 送信結果ステータスは配信メッセージの終端状態から、配信タイミング種別は配信用途から
 * それぞれ導出し（不整合な組合せを構造的に排除）、配信時点の payload を json で
 * 凍結する（OQ-34）。
 */
export function createLineDeliveryLog(params: {
  deliveryLogId: DeliveryLogId
  message: SentDeliveryMessage | FailedDeliveryMessage | SkippedDeliveryMessage
  sentPayloadJson: string
  idempotencyKey: string
}): LineDeliveryLog {
  const { message } = params
  const resultStatus: DeliveryResultStatus =
    message.kind === 'sent'
      ? { kind: 'success', lineMessageId: message.lineMessageId, sentAt: message.sentAt }
      : message.kind === 'failed'
        ? { kind: 'failure', failureReason: message.failureReason, failedAt: message.failedAt }
        : { kind: 'skipped', skipReason: message.skipReason, skippedAt: message.skippedAt }
  return LineDeliveryLogSchema.parse({
    deliveryLogId: params.deliveryLogId,
    deliveryMessageId: message.common.deliveryMessageId,
    timingKind: TIMING_KIND_BY_PURPOSE[message.common.purpose],
    target: message.common.target,
    sentPayloadJson: params.sentPayloadJson,
    resultStatus,
    idempotencyKey: params.idempotencyKey,
  })
}
