import { describe, it, expect } from 'vitest'
import { MitsuiSumitomoUnpaidSchema } from '../../../src/balance-asset-tracking/aggregates/MitsuiSumitomoUnpaid'

describe('MitsuiSumitomoUnpaid 集約', () => {
  it('当月未払金合計 = Σ 計上中エントリ金額が一致すれば parse 成功', () => {
    expect(() =>
      MitsuiSumitomoUnpaidSchema.parse({
        unpaidAggregateId: '01NP0000000000000000000001' as never,
        accountId: '01ACC000000000000000000001' as never,
        currentMonthUnpaidTotal: 8000 as never,
        entries: [
          {
            kind: 'booked',
            entryId: '01ENT000000000000000000001' as never,
            transactionId: '01TX0000000000000000000001' as never,
            bookedAt: new Date(),
            amount: 3000 as never,
          },
          {
            kind: 'booked',
            entryId: '01ENT000000000000000000002' as never,
            transactionId: '01TX0000000000000000000002' as never,
            bookedAt: new Date(),
            amount: 5000 as never,
          },
        ],
        lastSettledAt: null,
      }),
    ).not.toThrow()
  })

  it('当月未払金合計 ≠ Σ 計上中エントリ金額なら parse 失敗', () => {
    expect(() =>
      MitsuiSumitomoUnpaidSchema.parse({
        unpaidAggregateId: '01NP0000000000000000000001' as never,
        accountId: '01ACC000000000000000000001' as never,
        currentMonthUnpaidTotal: 10000 as never,
        entries: [
          {
            kind: 'booked',
            entryId: '01ENT000000000000000000001' as never,
            transactionId: '01TX0000000000000000000001' as never,
            bookedAt: new Date(),
            amount: 3000 as never,
          },
          {
            kind: 'booked',
            entryId: '01ENT000000000000000000002' as never,
            transactionId: '01TX0000000000000000000002' as never,
            bookedAt: new Date(),
            amount: 5000 as never,
          },
        ],
        lastSettledAt: null,
      }),
    ).toThrow()
  })

  it('引落消込済みエントリは合計に含めない（消込後 currentMonthUnpaidTotal=0）', () => {
    expect(() =>
      MitsuiSumitomoUnpaidSchema.parse({
        unpaidAggregateId: '01NP0000000000000000000001' as never,
        accountId: '01ACC000000000000000000001' as never,
        currentMonthUnpaidTotal: 0 as never,
        entries: [
          {
            kind: 'settled',
            entryId: '01ENT000000000000000000001' as never,
            transactionId: '01TX0000000000000000000001' as never,
            bookedAt: new Date(),
            settledAt: new Date(),
            amount: 3000 as never,
            settlementNoticeId: 'notice_001' as never,
          },
        ],
        lastSettledAt: new Date(),
      }),
    ).not.toThrow()
  })

  it('未払金エントリ無し（initial 状態）も parse 成功', () => {
    expect(() =>
      MitsuiSumitomoUnpaidSchema.parse({
        unpaidAggregateId: '01NP0000000000000000000001' as never,
        accountId: '01ACC000000000000000000001' as never,
        currentMonthUnpaidTotal: 0 as never,
        entries: [],
        lastSettledAt: null,
      }),
    ).not.toThrow()
  })
})
