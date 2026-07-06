import { describe, it, expect } from 'vitest'
import { LineDeliveryLogSchema } from '../../../src/notification-delivery/aggregates/LineDeliveryLog'

const base = {
  deliveryLogId: 'log_001' as never,
  deliveryMessageId: 'msg_001' as never,
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
