import { describe, it, expect } from 'vitest'
import { MitsuiSumitomoUnpaidSchema } from '../../../src/balance-asset-tracking/aggregates/MitsuiSumitomoUnpaid'

describe('MitsuiSumitomoUnpaid 集約', () => {
  it('当月未払金合計 = Σ 計上中エントリ金額が一致すれば parse 成功', () => {
    expect(() =>
      MitsuiSumitomoUnpaidSchema.parse({
        unpaidAggregateId: 'unp_001' as never,
        accountId: 'acc_001' as never,
        currentMonthUnpaidTotal: 8000 as never,
        entries: [
          {
            kind: 'booked',
            entryId: 'ent_001' as never,
            transactionId: 'tx_001' as never,
            bookedAt: new Date(),
            amount: 3000 as never,
          },
          {
            kind: 'booked',
            entryId: 'ent_002' as never,
            transactionId: 'tx_002' as never,
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
        unpaidAggregateId: 'unp_001' as never,
        accountId: 'acc_001' as never,
        currentMonthUnpaidTotal: 10000 as never,
        entries: [
          {
            kind: 'booked',
            entryId: 'ent_001' as never,
            transactionId: 'tx_001' as never,
            bookedAt: new Date(),
            amount: 3000 as never,
          },
          {
            kind: 'booked',
            entryId: 'ent_002' as never,
            transactionId: 'tx_002' as never,
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
        unpaidAggregateId: 'unp_001' as never,
        accountId: 'acc_001' as never,
        currentMonthUnpaidTotal: 0 as never,
        entries: [
          {
            kind: 'settled',
            entryId: 'ent_001' as never,
            transactionId: 'tx_001' as never,
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
        unpaidAggregateId: 'unp_001' as never,
        accountId: 'acc_001' as never,
        currentMonthUnpaidTotal: 0 as never,
        entries: [],
        lastSettledAt: null,
      }),
    ).not.toThrow()
  })
})
