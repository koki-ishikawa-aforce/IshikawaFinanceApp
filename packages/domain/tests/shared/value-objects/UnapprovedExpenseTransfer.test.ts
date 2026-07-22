import { describe, it, expect } from 'vitest'
import { UnapprovedExpenseTransferSchema } from '../../../src/shared/value-objects/UnapprovedExpenseTransfer'

const base = {
  originalBusinessExpenseTransactionId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  transferTarget: 'personal_darling',
  transferredAt: new Date('2026-01-01T00:00:00Z'),
}

describe('UnapprovedExpenseTransfer', () => {
  it('正の振替金額を受け入れる', () => {
    expect(() =>
      UnapprovedExpenseTransferSchema.parse({ ...base, transferAmount: 1500 }),
    ).not.toThrow()
  })

  it('0 円の振替金額を拒否する', () => {
    expect(() => UnapprovedExpenseTransferSchema.parse({ ...base, transferAmount: 0 })).toThrow()
  })

  it('負の振替金額を拒否する', () => {
    expect(() => UnapprovedExpenseTransferSchema.parse({ ...base, transferAmount: -100 })).toThrow()
  })
})
