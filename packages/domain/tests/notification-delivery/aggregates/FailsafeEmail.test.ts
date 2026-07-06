import { describe, it, expect } from 'vitest'
import {
  FailsafeEmailSchema,
  startSendingFailsafeEmail,
  markFailsafeEmailSent,
  markFailsafeEmailFailed,
  type ReservedFailsafeEmail,
} from '../../../src/notification-delivery/aggregates/FailsafeEmail'

const common = {
  failsafeEmailId: '01FSE000000000000000000001' as never,
  toEmailAddress: 'honey@example.com',
  subject: 'LINE 通知の連続失敗を検知しました',
  body: '通知配信が連続で失敗しています。設定をご確認ください。',
  causingCounterRef: { kind: 'talk_room', talkRoomId: 'room_001' as never },
}

describe('FailsafeEmail 集約', () => {
  it('送信予約済み（起因カウンタ参照つき）は parse 成功', () => {
    expect(() =>
      FailsafeEmailSchema.parse({ kind: 'reserved', common, reservedAt: new Date() }),
    ).not.toThrow()
  })

  it('宛先が不正なメールアドレスなら parse 失敗', () => {
    expect(() =>
      FailsafeEmailSchema.parse({
        kind: 'reserved',
        common: { ...common, toEmailAddress: 'not-an-email' },
        reservedAt: new Date(),
      }),
    ).toThrow()
  })

  it('起因カウンタ参照が欠落なら parse 失敗（しきい値到達済みカウンタがある場合のみ生成）', () => {
    const withoutRef: Record<string, unknown> = { ...common }
    delete withoutRef['causingCounterRef']
    expect(() =>
      FailsafeEmailSchema.parse({ kind: 'reserved', common: withoutRef, reservedAt: new Date() }),
    ).toThrow()
  })

  it('予約 → 送信中 → 成功 / 失敗 の遷移', () => {
    const reserved = FailsafeEmailSchema.parse({
      kind: 'reserved',
      common,
      reservedAt: new Date(),
    }) as ReservedFailsafeEmail
    const sending = startSendingFailsafeEmail(reserved, new Date())
    expect(sending.kind).toBe('sending')
    expect(markFailsafeEmailSent(sending, 'ses-message-id-001', new Date()).kind).toBe('sent')
    expect(markFailsafeEmailFailed(sending, 'ses_failure', new Date()).kind).toBe('failed')
  })
})
