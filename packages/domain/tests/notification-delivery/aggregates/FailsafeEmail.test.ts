import { describe, it, expect } from 'vitest'
import {
  CommonFailsafeEmailAttrsSchema,
  FailsafeEmailSchema,
  isFailsafeCovered,
  reserveFailsafeEmail,
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

describe('reserveFailsafeEmail / isFailsafeCovered', () => {
  it('起因カウンタ参照付きで送信予約済みメールを生成する', () => {
    const reserved = reserveFailsafeEmail(
      CommonFailsafeEmailAttrsSchema.parse(common),
      new Date('2026-07-01T00:00:00Z'),
    )
    expect(reserved.kind).toBe('reserved')
    expect(reserved.common.causingCounterRef).toEqual(common.causingCounterRef)
  })

  it('OAuth 失効通知のみメールフェイルセーフの対象外（OQ-2）', () => {
    expect(isFailsafeCovered('oauth_revocation_notice')).toBe(false)
    for (const purpose of [
      'csv_import_reminder',
      'monthly_report_household_summary',
      'monthly_report_personal_summary',
      'test_message',
    ] as const) {
      expect(isFailsafeCovered(purpose)).toBe(true)
    }
  })
})
