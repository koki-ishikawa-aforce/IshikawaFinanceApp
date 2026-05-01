import { describe, it, expect } from 'vitest'
import { MoneySchema, money, addMoney, subtractMoney } from '../../../src/shared/value-objects/Money'

describe('Money', () => {
  it('整数を受け入れる', () => {
    expect(() => money(1000)).not.toThrow()
    expect(() => money(0)).not.toThrow()
    expect(() => money(-500)).not.toThrow()  // 返金等で負の値も許容
  })

  it('小数を拒否する', () => {
    expect(() => money(100.5)).toThrow()
  })

  it('Infinity / NaN を拒否する', () => {
    expect(() => money(Infinity)).toThrow()
    expect(() => money(NaN)).toThrow()
  })

  it('addMoney は 2 つの Money を加算する', () => {
    expect(addMoney(money(1000), money(500))).toBe(1500)
  })

  it('subtractMoney は 2 つの Money を減算する', () => {
    expect(subtractMoney(money(1000), money(300))).toBe(700)
  })

  it('Schema は branded 型を返す', () => {
    const m = MoneySchema.parse(100)
    expect(typeof m).toBe('number')
    expect(m).toBe(100)
  })
})
