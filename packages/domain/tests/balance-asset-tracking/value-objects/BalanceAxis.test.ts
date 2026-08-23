import { describe, it, expect } from 'vitest'
import {
  BalanceAxisSchema,
  balanceAxisOfAccountKind,
} from '../../../src/balance-asset-tracking/value-objects/BalanceAxis'

describe('残高軸（#398）', () => {
  it('4 本の線に対応する 4 値だけを受け付ける', () => {
    expect(BalanceAxisSchema.options).toEqual([
      'smbc_balance',
      'other_savings_balance',
      'nisa_contribution',
      'card_unpaid',
    ])
    expect(() => BalanceAxisSchema.parse('crypto')).toThrow()
  })

  describe('balanceAxisOfAccountKind', () => {
    it('口座種別ごとに対応する軸を返す（カードは残高ではなく未払い合計の軸）', () => {
      expect(balanceAxisOfAccountKind('smbc_bank')).toBe('smbc_balance')
      expect(balanceAxisOfAccountKind('other_savings')).toBe('other_savings_balance')
      expect(balanceAxisOfAccountKind('nisa')).toBe('nisa_contribution')
      expect(balanceAxisOfAccountKind('mitsui_sumitomo_card')).toBe('card_unpaid')
    })
  })
})
