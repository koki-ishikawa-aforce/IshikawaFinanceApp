import { describe, expect, it } from 'vitest'
import { formatMoney } from '../format'

describe('formatMoney', () => {
  it('3桁区切りと「円」で整形する', () => {
    expect(formatMoney(1234567)).toBe('1,234,567円')
  })

  it('0 円を整形する', () => {
    expect(formatMoney(0)).toBe('0円')
  })

  it('負の金額を整形する', () => {
    // 返金が支出を上回った月など。符号は先頭に付け、単位は末尾のまま動かさない
    expect(formatMoney(-5000)).toBe('-5,000円')
  })

  it('3桁に満たない金額に区切りを入れない', () => {
    expect(formatMoney(980)).toBe('980円')
  })

  it('記号（¥）を混ぜない', () => {
    // 5-3 は記号と単位の混在を禁じている。片方だけ残ると画面間で表記がぶれる
    expect(formatMoney(1580)).not.toContain('¥')
  })
})
