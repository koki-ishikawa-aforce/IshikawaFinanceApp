import { describe, it, expect } from 'vitest'
import { AmazonMatchStateSchema } from '../../../src/auto-classification/value-objects/AmazonMatchState'

describe('AmazonMatchState（Amazon 突合状態）', () => {
  it('突合済みは取引IDと突合確定日時だけで成立する（商品キーは持たない、#572）', () => {
    const parsed = AmazonMatchStateSchema.parse({
      kind: 'matched',
      transactionId: '01TX0000000000000000000001',
      matchedAt: new Date('2026-08-23T00:00:00Z'),
    })
    expect(parsed).toEqual({
      kind: 'matched',
      transactionId: '01TX0000000000000000000001',
      matchedAt: new Date('2026-08-23T00:00:00Z'),
    })
  })

  it('突合待ちはタイムアウト期限を持つ（SMBC 先着 / Amazon 先着の双方向）', () => {
    const awaitingAmazon = AmazonMatchStateSchema.parse({
      kind: 'awaiting_amazon',
      transactionId: '01TX0000000000000000000001',
      smbcNoticeArrivedAt: new Date('2026-08-20T00:00:00Z'),
      timeoutAt: new Date('2026-08-23T00:00:00Z'),
    })
    const awaitingSmbc = AmazonMatchStateSchema.parse({
      kind: 'awaiting_smbc',
      amazonOrderId: '250-1234567-1234567',
      amazonArrivedAt: new Date('2026-08-20T00:00:00Z'),
      timeoutAt: new Date('2026-08-23T00:00:00Z'),
    })
    expect(awaitingAmazon.kind).toBe('awaiting_amazon')
    expect(awaitingSmbc.kind).toBe('awaiting_smbc')
  })

  it('突合確定日時が無ければ parse 失敗（いつ突合したか不明な突合済みを作らせない）', () => {
    expect(() =>
      AmazonMatchStateSchema.parse({
        kind: 'matched',
        transactionId: '01TX0000000000000000000001',
      }),
    ).toThrow()
  })
})
