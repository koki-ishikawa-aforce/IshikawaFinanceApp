import { describe, it, expect } from 'vitest'
import {
  isAmazonMerchantName,
  normalizeMerchantName,
} from '../../../src/transaction-import/value-objects/NormalizedMerchantName'

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

describe('isAmazonMerchantName（Amazon 突合の相手を絞る判定）', () => {
  it('カード利用通知で観測される Amazon の表記ゆれをまとめて真にする', () => {
    expect(isAmazonMerchantName('AMAZON CO JP')).toBe(true)
    expect(isAmazonMerchantName('AMAZON.CO.JP')).toBe(true)
    expect(isAmazonMerchantName('Amazon.co.jp')).toBe(true)
    expect(isAmazonMerchantName('AMAZON MARKETPLACE')).toBe(true)
  })

  it('Amazon 以外の加盟店は偽（金額が一致しても突合の相手にしない）', () => {
    expect(isAmazonMerchantName('スーパーA')).toBe(false)
    expect(isAmazonMerchantName('RAKUTEN')).toBe(false)
    expect(isAmazonMerchantName('')).toBe(false)
    // 名前の途中に含まれるだけの加盟店は対象にしない
    expect(isAmazonMerchantName('MY AMAZON SHOP')).toBe(false)
  })
})
