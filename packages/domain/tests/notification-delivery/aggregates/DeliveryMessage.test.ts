import { describe, it, expect } from 'vitest'
import {
  CommonDeliveryMessageAttrsSchema,
  DeliveryMessageSchema,
  reserveDeliveryMessage,
  startSendingMessage,
  markMessageSent,
  markMessageSendFailed,
  skipDeliveryMessage,
  type ReservedDeliveryMessage,
} from '../../../src/notification-delivery/aggregates/DeliveryMessage'

const talkRoomTarget = { kind: 'shared_talk_room', talkRoomId: 'room_001' as never }
const dmTarget = { kind: 'personal_dm', userId: 'user_honey' as never }
const content = { kind: 'plain_text', textBody: 'CSV 取込をお願いします' }

function reserved(purpose: string, target: unknown) {
  return {
    kind: 'reserved',
    common: {
      deliveryMessageId: '01MSG000000000000000000001' as never,
      target,
      content,
      purpose,
    },
    reservedAt: new Date(),
  }
}

describe('DeliveryMessage 集約', () => {
  it('リマインダー × 共通トークルーム は parse 成功', () => {
    expect(() =>
      DeliveryMessageSchema.parse(reserved('csv_import_reminder', talkRoomTarget)),
    ).not.toThrow()
  })

  it('リマインダー × 個人DM は parse 失敗（配信用途×配信先マトリクス）', () => {
    expect(() => DeliveryMessageSchema.parse(reserved('csv_import_reminder', dmTarget))).toThrow()
  })

  it('個人サマリ / OAuth失効通知 × 個人DM は parse 成功', () => {
    for (const purpose of ['monthly_report_personal_summary', 'oauth_revocation_notice']) {
      expect(() => DeliveryMessageSchema.parse(reserved(purpose, dmTarget))).not.toThrow()
    }
  })

  it('個人サマリ × 共通トークルーム は parse 失敗', () => {
    expect(() =>
      DeliveryMessageSchema.parse(reserved('monthly_report_personal_summary', talkRoomTarget)),
    ).toThrow()
  })

  it('送信成功は lineMessageId が必須（欠落で parse 失敗）', () => {
    expect(() =>
      DeliveryMessageSchema.parse({
        kind: 'sent',
        common: reserved('test_message', talkRoomTarget).common,
        sentAt: new Date(),
      }),
    ).toThrow()
  })

  it('予約 → 送信中 → 成功 / 失敗、予約 → スキップ の遷移', () => {
    const msg = DeliveryMessageSchema.parse(
      reserved('test_message', talkRoomTarget),
    ) as ReservedDeliveryMessage
    const sending = startSendingMessage(msg, new Date())
    expect(sending.kind).toBe('sending')
    expect(markMessageSent(sending, 'line_msg_001' as never, new Date()).kind).toBe('sent')
    expect(
      markMessageSendFailed(sending, 'line_api_failure', 'retry_scheduled', new Date()).kind,
    ).toBe('failed')
    expect(skipDeliveryMessage(msg, 'reminder_stop_condition_met', new Date()).kind).toBe('skipped')
  })
})

describe('reserveDeliveryMessage（予約ファクトリ）', () => {
  const common = (purpose: string, target: unknown) => ({
    deliveryMessageId: '01HZX3F2M9GQ4T8VWYJ5KNBC6D',
    target,
    content,
    purpose,
  })

  it('整合する用途 × 配信先で送信予約済みメッセージを生成する', () => {
    const reserved = reserveDeliveryMessage(
      CommonDeliveryMessageAttrsSchema.parse(common('test_message', talkRoomTarget)),
      new Date('2026-07-01T00:00:00Z'),
    )
    expect(reserved.kind).toBe('reserved')
    expect(reserved.reservedAt).toEqual(new Date('2026-07-01T00:00:00Z'))
  })

  it('用途 × 配信先が不整合なら throw（superRefine が予約段階で拒否）', () => {
    expect(() =>
      reserveDeliveryMessage(
        CommonDeliveryMessageAttrsSchema.parse(
          common('monthly_report_personal_summary', talkRoomTarget),
        ),
        new Date(),
      ),
    ).toThrow()
  })
})
