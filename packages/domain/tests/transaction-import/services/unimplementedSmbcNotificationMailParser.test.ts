import { describe, it, expect } from 'vitest'
import { createUnimplementedSmbcMailParser } from '../../../src/transaction-import/services/unimplementedSmbcNotificationMailParser'
import type { SmbcNotificationMailBody } from '../../../src/transaction-import/services/GmailMailFetchGateway'

const AT = new Date('2026-07-10T00:00:00+09:00')

const mail: SmbcNotificationMailBody = {
  gmailMessageId: 'gmail-1' as never,
  receivedAt: new Date('2026-07-09T12:34:00+09:00'),
  subject: 'ご利用のお知らせ【三井住友カード】',
  body: 'ご利用金額 1,200円',
  kindHint: 'card_usage',
}

describe('パース未実装版（#415 が入るまでの差し替え先）', () => {
  it('どのメールもパース失敗として返し、取引候補の材料を作らない', () => {
    const result = createUnimplementedSmbcMailParser()({
      mail,
      userId: 'user_honey' as never,
      at: AT,
    })
    expect(result).toEqual({
      kind: 'parse_failure',
      gmailMessageId: 'gmail-1',
      reason: 'other',
      detectedAt: AT,
    })
  })

  it('種別ヒントが付いていても本文を読まない（例外も投げない）', () => {
    const result = createUnimplementedSmbcMailParser()({
      mail: { ...mail, kindHint: 'bank_deposit' },
      userId: 'user_honey' as never,
      at: AT,
    })
    expect(result.kind).toBe('parse_failure')
  })
})
