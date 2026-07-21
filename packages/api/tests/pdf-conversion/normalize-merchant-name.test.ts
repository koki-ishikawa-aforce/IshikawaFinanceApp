import { describe, it, expect } from 'vitest'
import { normalizeMerchantName } from '../../src/pdf-conversion/normalize-merchant-name.js'

describe('normalizeMerchantName（OQ-23: NFKC + 空白圧縮 + 長音統一）', () => {
  it('全角英数・半角カナを NFKC で正規化する', () => {
    expect(normalizeMerchantName('ＡＭＡＺＯＮ．ＣＯ．ＪＰ')).toBe('AMAZON.CO.JP')
    expect(normalizeMerchantName('ｽｰﾊﾟｰﾏｰｹｯﾄ')).toBe('スーパーマーケット')
  })

  it('連続空白を 1 つに圧縮し前後の空白を除去する', () => {
    expect(normalizeMerchantName('  スーパー　　マーケット  ')).toBe('スーパー マーケット')
  })

  it('カタカナ直後のハイフン類を長音記号に統一する', () => {
    expect(normalizeMerchantName('コ-ヒ-ショップ')).toBe('コーヒーショップ')
    expect(normalizeMerchantName('スーパ−マーケット')).toBe('スーパーマーケット')
    expect(normalizeMerchantName('タクシ—')).toBe('タクシー')
  })

  it('カタカナに続かないハイフンは変更しない', () => {
    expect(normalizeMerchantName('JR-EAST')).toBe('JR-EAST')
    expect(normalizeMerchantName('7-ELEVEN')).toBe('7-ELEVEN')
  })

  it('半角長音「ｰ」は NFKC 経由で「ー」になる', () => {
    expect(normalizeMerchantName('ｺｰﾋｰ')).toBe('コーヒー')
  })
})
