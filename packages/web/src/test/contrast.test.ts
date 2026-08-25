import { describe, expect, it } from 'vitest'
import { contrastRatio, parseHex } from './contrast'

/** 比率の計算そのものが壊れていないことを固定する(壊れると利用側のテストが常に緑になる) */
describe('コントラスト比の計算', () => {
  it('既知の値と一致する', () => {
    expect(contrastRatio(parseHex('#ffffff'), parseHex('#000000'))).toBeCloseTo(21, 5)
    expect(contrastRatio(parseHex('#ffffff'), parseHex('#ffffff'))).toBeCloseTo(1, 5)
    // 修正前のはにーの金額カード(白文字 × #80a8d0)。下限(4.5)を割る組み合わせを検出できる
    expect(contrastRatio(parseHex('#ffffff'), parseHex('#80a8d0'))).toBeLessThan(4.5)
    // だーりんの金額カード文字色を吹き出し(--text-primary)へ流用した場合
    expect(contrastRatio(parseHex('#3d1420'), parseHex('#5a2840'))).toBeLessThan(4.5)
  })
})
