/**
 * 通知配信コンテキストのテストフィクスチャ
 */
import type {
  ConsecutiveFailureCounter,
  DeliveryMessage,
  FailsafeEmail,
  FailureCounterRef,
  LineDeliveryLog,
  UserId,
} from '@warimaru/domain'
import {
  ConsecutiveFailureCounterSchema,
  DeliveryMessageSchema,
  FailsafeEmailSchema,
  FailureCounterRefSchema,
  LineDeliveryLogSchema,
} from '@warimaru/domain'
import { newUlid } from '../../src/newId'
import { HONEY_USER_ID } from './fixtures'

const TALK_ROOM_ID = 'talk-room-1'

export function reservedReminderMessage(): DeliveryMessage {
  return DeliveryMessageSchema.parse({
    kind: 'reserved',
    common: {
      deliveryMessageId: newUlid(),
      target: { kind: 'shared_talk_room', talkRoomId: TALK_ROOM_ID },
      content: { kind: 'plain_text', textBody: 'CSV 取込のリマインダーです' },
      purpose: 'csv_import_reminder',
    },
    reservedAt: new Date('2026-07-07T00:00:00.000Z'),
  })
}

export function sentPersonalSummaryMessage(input: { userId?: UserId } = {}): DeliveryMessage {
  return DeliveryMessageSchema.parse({
    kind: 'sent',
    common: {
      deliveryMessageId: newUlid(),
      target: { kind: 'personal_dm', userId: input.userId ?? HONEY_USER_ID },
      content: {
        kind: 'flex_message',
        flexPayloadJson: '{"type":"bubble"}',
        linkUrl: 'https://example.com/report',
      },
      purpose: 'monthly_report_personal_summary',
    },
    sentAt: new Date('2026-07-07T01:00:00.000Z'),
    lineMessageId: `lm-${newUlid()}`,
  })
}

export function failedTestMessage(): DeliveryMessage {
  return DeliveryMessageSchema.parse({
    kind: 'failed',
    common: {
      deliveryMessageId: newUlid(),
      target: { kind: 'shared_talk_room', talkRoomId: TALK_ROOM_ID },
      content: { kind: 'plain_text', textBody: 'テスト送信' },
      purpose: 'test_message',
    },
    failedAt: new Date('2026-07-07T02:00:00.000Z'),
    failureReason: 'line_api_failure',
    retryState: 'retry_scheduled',
  })
}

/** 送信失敗の配信ログ（配信を確定させないため、同一冪等性キーで何件でも積める） */
export function failedDeliveryLog(input: { idempotencyKey?: string } = {}): LineDeliveryLog {
  return LineDeliveryLogSchema.parse({
    deliveryLogId: newUlid(),
    deliveryMessageId: newUlid(),
    timingKind: 'reminder',
    target: { kind: 'shared_talk_room', talkRoomId: TALK_ROOM_ID },
    sentPayloadJson: '{"type":"text","text":"リマインダー"}',
    resultStatus: {
      kind: 'failure',
      failureReason: 'line_api_failure',
      failedAt: new Date('2026-07-07T00:05:00.000Z'),
    },
    idempotencyKey: input.idempotencyKey ?? `idem-${newUlid()}`,
  })
}

/** 送信スキップの配信ログ（成功と同じく配信を確定させる） */
export function skippedDeliveryLog(input: { idempotencyKey?: string } = {}): LineDeliveryLog {
  return LineDeliveryLogSchema.parse({
    deliveryLogId: newUlid(),
    deliveryMessageId: newUlid(),
    timingKind: 'reminder',
    target: { kind: 'shared_talk_room', talkRoomId: TALK_ROOM_ID },
    sentPayloadJson: '{"skipped":true}',
    resultStatus: {
      kind: 'skipped',
      skipReason: 'notification_disabled',
      skippedAt: new Date('2026-07-07T00:05:00.000Z'),
    },
    idempotencyKey: input.idempotencyKey ?? `idem-${newUlid()}`,
  })
}

export function deliveryLog(input: { idempotencyKey?: string } = {}): LineDeliveryLog {
  return LineDeliveryLogSchema.parse({
    deliveryLogId: newUlid(),
    deliveryMessageId: newUlid(),
    timingKind: 'reminder',
    target: { kind: 'shared_talk_room', talkRoomId: TALK_ROOM_ID },
    sentPayloadJson: '{"type":"text","text":"リマインダー"}',
    resultStatus: {
      kind: 'success',
      lineMessageId: `lm-${newUlid()}`,
      sentAt: new Date('2026-07-07T00:05:00.000Z'),
    },
    idempotencyKey: input.idempotencyKey ?? `idem-${newUlid()}`,
  })
}

export function reservedFailsafeEmail(): FailsafeEmail {
  return FailsafeEmailSchema.parse({
    kind: 'reserved',
    common: {
      failsafeEmailId: newUlid(),
      toEmailAddress: 'honey@example.com',
      subject: 'LINE 通知の連続失敗を検知しました',
      body: 'LINE 通知が連続で失敗したためメールでお知らせします。',
      causingCounterRef: { kind: 'user', userId: HONEY_USER_ID },
    },
    reservedAt: new Date('2026-07-07T03:00:00.000Z'),
  })
}

export function sentFailsafeEmail(): FailsafeEmail {
  const base = reservedFailsafeEmail()
  return FailsafeEmailSchema.parse({
    kind: 'sent',
    common: base.common,
    sentAt: new Date('2026-07-07T03:05:00.000Z'),
    providerRef: `ses-${newUlid()}`,
  })
}

export function userCounterRef(userId: UserId = HONEY_USER_ID): FailureCounterRef {
  return FailureCounterRefSchema.parse({ kind: 'user', userId })
}

export function talkRoomCounterRef(): FailureCounterRef {
  return FailureCounterRefSchema.parse({ kind: 'talk_room', talkRoomId: TALK_ROOM_ID })
}

export function zeroCounter(ref: FailureCounterRef): ConsecutiveFailureCounter {
  return ConsecutiveFailureCounterSchema.parse({
    counterRef: ref,
    consecutiveFailureCount: 0,
    lastFailedAt: null,
    thresholdState: { kind: 'not_reached' },
  })
}

export function failingCounter(ref: FailureCounterRef, count = 2): ConsecutiveFailureCounter {
  return ConsecutiveFailureCounterSchema.parse({
    counterRef: ref,
    consecutiveFailureCount: count,
    lastFailedAt: new Date('2026-07-07T02:30:00.000Z'),
    thresholdState: { kind: 'not_reached' },
  })
}
