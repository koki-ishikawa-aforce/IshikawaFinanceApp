import { describe, it, expect } from 'vitest'
import {
  createLineDeliveryLog,
  LineDeliveryLogSchema,
} from '../../../src/notification-delivery/aggregates/LineDeliveryLog'
import {
  CommonDeliveryMessageAttrsSchema,
  DeliveryMessageSchema,
  type FailedDeliveryMessage,
  type SentDeliveryMessage,
  type SkippedDeliveryMessage,
} from '../../../src/notification-delivery/aggregates/DeliveryMessage'
import { DeliveryLogIdSchema } from '../../../src/shared/ids'

const base = {
  deliveryLogId: '01DG0000000000000000000001' as never,
  deliveryMessageId: '01MSG000000000000000000001' as never,
  timingKind: 'reminder',
  target: { kind: 'shared_talk_room', talkRoomId: 'room_001' as never },
  sentPayloadJson: '{"type":"flex"}',
  idempotencyKey: 'reminder-2026-07-room_001',
}

describe('LineDeliveryLog 集約', () => {
  it('成功 / 失敗 / スキップ の 3 結果ステータスとも parse 成功', () => {
    const statuses = [
      { kind: 'success', lineMessageId: 'line_msg_001' as never, sentAt: new Date() },
      { kind: 'failure', failureReason: 'line_api_failure', failedAt: new Date() },
      { kind: 'skipped', skipReason: 'notification_disabled', skippedAt: new Date() },
    ]
    for (const resultStatus of statuses) {
      expect(() => LineDeliveryLogSchema.parse({ ...base, resultStatus })).not.toThrow()
    }
  })

  it('冪等性キーが空文字なら parse 失敗（同月レポート再送信の重複防止）', () => {
    expect(() =>
      LineDeliveryLogSchema.parse({
        ...base,
        idempotencyKey: '',
        resultStatus: {
          kind: 'success',
          lineMessageId: 'line_msg_001' as never,
          sentAt: new Date(),
        },
      }),
    ).toThrow()
  })

  it('送信 payload が空なら parse 失敗（監査記録として不完全）', () => {
    expect(() =>
      LineDeliveryLogSchema.parse({
        ...base,
        sentPayloadJson: '',
        resultStatus: {
          kind: 'success',
          lineMessageId: 'line_msg_001' as never,
          sentAt: new Date(),
        },
      }),
    ).toThrow()
  })
})

describe('createLineDeliveryLog（終端状態からの組立）', () => {
  const common = CommonDeliveryMessageAttrsSchema.parse({
    deliveryMessageId: '01HZX3F2M9GQ4T8VWYJ5KNBC6D',
    target: { kind: 'shared_talk_room', talkRoomId: 'room_001' },
    content: { kind: 'plain_text', textBody: 'テスト本文' },
    purpose: 'test_message',
  })
  const deliveryLogId = DeliveryLogIdSchema.parse('01HZX3F2M9GQ4T8VWYJ5KNBC6E')
  const baseParams = { deliveryLogId, sentPayloadJson: '{"stub":true}', idempotencyKey: 'key-1' }

  it('sent → success（LINE message ID と送信完了日時を凍結）', () => {
    const message = DeliveryMessageSchema.parse({
      kind: 'sent',
      common,
      sentAt: new Date('2026-07-01T00:00:00Z'),
      lineMessageId: 'line-msg-1',
    }) as SentDeliveryMessage
    const log = createLineDeliveryLog({ ...baseParams, message })
    expect(log.resultStatus).toEqual({
      kind: 'success',
      lineMessageId: 'line-msg-1',
      sentAt: new Date('2026-07-01T00:00:00Z'),
    })
    expect(log.deliveryMessageId).toBe(common.deliveryMessageId)
    expect(log.sentPayloadJson).toBe('{"stub":true}')
  })

  it('failed → failure（失敗理由と失敗日時を凍結）', () => {
    const message = DeliveryMessageSchema.parse({
      kind: 'failed',
      common,
      failedAt: new Date('2026-07-01T00:00:00Z'),
      failureReason: 'timeout',
      retryState: 'retry_abandoned',
    }) as FailedDeliveryMessage
    const log = createLineDeliveryLog({ ...baseParams, message })
    expect(log.resultStatus).toEqual({
      kind: 'failure',
      failureReason: 'timeout',
      failedAt: new Date('2026-07-01T00:00:00Z'),
    })
  })

  it('skipped → skipped（スキップ理由とスキップ日時を凍結）', () => {
    const message = DeliveryMessageSchema.parse({
      kind: 'skipped',
      common,
      skippedAt: new Date('2026-07-01T00:00:00Z'),
      skipReason: 'notification_disabled',
    }) as SkippedDeliveryMessage
    const log = createLineDeliveryLog({ ...baseParams, message })
    expect(log.resultStatus).toEqual({
      kind: 'skipped',
      skipReason: 'notification_disabled',
      skippedAt: new Date('2026-07-01T00:00:00Z'),
    })
  })

  it('配信タイミング種別は配信用途から導出される（不整合な組合せを排除）', () => {
    const messageOf = (purpose: string, target: unknown) =>
      DeliveryMessageSchema.parse({
        kind: 'sent',
        common: { ...common, purpose, target },
        sentAt: new Date(),
        lineMessageId: 'line-msg-1',
      }) as SentDeliveryMessage
    const talkRoom = { kind: 'shared_talk_room', talkRoomId: 'room_001' }
    const dm = { kind: 'personal_dm', userId: 'user_honey' }
    const cases: [string, unknown, string][] = [
      ['test_message', talkRoom, 'test_send'],
      ['csv_import_reminder', talkRoom, 'reminder'],
      ['monthly_report_household_summary', talkRoom, 'csv_confirmation'],
      ['monthly_report_personal_summary', dm, 'csv_confirmation'],
      ['oauth_revocation_notice', dm, 'oauth_revocation_detected'],
    ]
    for (const [purpose, target, expected] of cases) {
      expect(
        createLineDeliveryLog({ ...baseParams, message: messageOf(purpose, target) }).timingKind,
      ).toBe(expected)
    }
  })
})
