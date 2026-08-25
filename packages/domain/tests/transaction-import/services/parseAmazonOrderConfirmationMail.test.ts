/**
 * Amazon 注文確認メールのパース（08a §2 / OQ-1(4)）のテスト。
 *
 * 本文は 2026-07-26 の実メール観察（#391 のコメント）で確認した `text/plain` の行構造に沿わせて
 * ある。読めなかったものを黙って 0 円や空の注文として通さないこと（未分類のままにするより
 * 誤った金額を家計簿へ入れるほうが害が大きい）を否定形で押さえる。
 *
 * 送信元ドメインだけで絞って取得するため、発送のお知らせ等の注文確認以外の Amazon メールも
 * 同じ袋で届く（#624）。これらが `parse_failure` に混ざらないことを否定形で押さえる。
 */
import { describe, it, expect } from 'vitest'
import { parseAmazonOrderConfirmationMail } from '../../../src/transaction-import/services/parseAmazonOrderConfirmationMail'
import type { AmazonOrderConfirmationMailBody } from '../../../src/transaction-import/services/GmailMailFetchGateway'

const RECEIVED_AT = new Date('2026-07-15T09:53:00+09:00')
const USER_ID = 'user_honey' as never
const AT = new Date('2026-07-16T00:00:00+09:00')

/** 注文確認メールの目印（実メール観察 2026-07-26 / #391 の挨拶文） */
const ORDER_CONFIRMATION_GREETING = 'Amazon.co.jp でのご注文ありがとうございます。'

/** 実メール観察に沿った本文（注文番号 / 商品ブロック / 合計） */
const REAL_BODY = [
  ORDER_CONFIRMATION_GREETING,
  '',
  '注文番号: 250-1234567-1234567',
  '注文内容の確認と変更は下記のページからお願いします。',
  '',
  '* マスタリングTCP/IP―入門編―(第6版)',
  '  数量: 1',
  '  2420 JPY',
  '',
  '合計 2420 JPY',
  '',
].join('\n')

function mail(overrides: Partial<AmazonOrderConfirmationMailBody> = {}) {
  return {
    gmailMessageId: 'gm_amazon_1' as never,
    receivedAt: RECEIVED_AT,
    subject: '注文済み: 「マスタリングTCP/IP―入門編―(第6版)」',
    body: REAL_BODY,
    ...overrides,
  }
}

function parse(overrides: Partial<AmazonOrderConfirmationMailBody> = {}) {
  return parseAmazonOrderConfirmationMail({ mail: mail(overrides), userId: USER_ID, at: AT })
}

describe('parseAmazonOrderConfirmationMail: 注文確認メールから注文情報を取り出す', () => {
  it('注文番号・注文合計・商品名を取り出し、注文日時にメールの受信日時を使う', () => {
    const result = parse()

    expect(result.kind).toBe('order_confirmation')
    if (result.kind !== 'order_confirmation') return
    expect(result.order.amazonOrderId).toBe('250-1234567-1234567')
    expect(result.order.orderTotal).toBe(2420)
    expect(result.order.orderedAt).toEqual(RECEIVED_AT)
    expect(result.order.gmailMessageId).toBe('gm_amazon_1')
    expect(result.order.userId).toBe(USER_ID)
    expect(result.order.products).toEqual([
      { productName: 'マスタリングTCP/IP―入門編―(第6版)', productAmount: 2420 },
    ])
  })

  it('商品が複数ある注文はすべての商品を取り出す', () => {
    const body = [
      ORDER_CONFIRMATION_GREETING,
      '',
      '注文番号: 250-7654321-7654321',
      '',
      '* コーヒー豆 500g',
      '  数量: 2',
      '  1800 JPY',
      '',
      '* ドリップスタンド',
      '  数量: 1',
      '  3,200 JPY',
      '',
      '合計 5,000 JPY',
    ].join('\n')

    const result = parse({ body })

    expect(result.kind).toBe('order_confirmation')
    if (result.kind !== 'order_confirmation') return
    expect(result.order.orderTotal).toBe(5000)
    expect(result.order.products).toEqual([
      { productName: 'コーヒー豆 500g', productAmount: 1800 },
      // カンマ区切りの単価がそのまま数値として読めていること
      { productName: 'ドリップスタンド', productAmount: 3200 },
    ])
  })

  it('請求額と合計が食い違う場合は請求額（カードに請求される金額）を採る', () => {
    const body = [
      ORDER_CONFIRMATION_GREETING,
      '',
      '注文番号: 250-1111111-1111111',
      '',
      '* ギフト券併用の商品',
      '  数量: 1',
      '  3000 JPY',
      '',
      '合計 3000 JPY',
      'ご請求額: 1000 JPY',
    ].join('\n')

    const result = parse({ body })

    expect(result.kind).toBe('order_confirmation')
    if (result.kind !== 'order_confirmation') return
    expect(result.order.orderTotal).toBe(1000)
  })

  it('全角で届いた本文も同じ規則で読める（NFKC 正規化）', () => {
    const body = [
      ORDER_CONFIRMATION_GREETING,
      '',
      '注文番号：２５０－２２２２２２２－２２２２２２２',
      '',
      '＊　全角で届いた商品',
      '　　数量：１',
      '　　１，２００　ＪＰＹ',
      '',
      '合計　１，２００　ＪＰＹ',
    ].join('\n')

    const result = parse({ body })

    expect(result.kind).toBe('order_confirmation')
    if (result.kind !== 'order_confirmation') return
    expect(result.order.amazonOrderId).toBe('250-2222222-2222222')
    expect(result.order.orderTotal).toBe(1200)
  })

  it('注文確認の目印はあるが注文番号が無い本文は構造不一致として失敗する（注文として通さない）', () => {
    const body = [
      ORDER_CONFIRMATION_GREETING,
      '',
      '* 商品名',
      '  数量: 1',
      '  1000 JPY',
      '',
      '合計 1000 JPY',
    ].join('\n')

    const result = parse({ body })

    expect(result).toMatchObject({
      kind: 'parse_failure',
      gmailMessageId: 'gm_amazon_1',
      reason: 'structure_mismatch',
      detectedAt: AT,
    })
  })

  it('合計が無い本文は必須項目欠落として失敗する（0 円の注文にしない）', () => {
    const body = [
      ORDER_CONFIRMATION_GREETING,
      '',
      '注文番号: 250-3333333-3333333',
      '',
      '* 商品名',
      '  数量: 1',
      '  1000 JPY',
    ].join('\n')

    expect(parse({ body })).toMatchObject({
      kind: 'parse_failure',
      reason: 'missing_required_field',
    })
  })

  it('数量行を伴わない箇条書きは商品として取り込まない（商品が 1 件も無ければ失敗）', () => {
    const body = [
      ORDER_CONFIRMATION_GREETING,
      '',
      '注文番号: 250-4444444-4444444',
      '',
      '* お届け先の変更はこちら',
      '* 配送状況の確認はこちら',
      '',
      '合計 1000 JPY',
    ].join('\n')

    expect(parse({ body })).toMatchObject({
      kind: 'parse_failure',
      reason: 'missing_required_field',
    })
  })

  it('商品ブロックに金額が無ければその商品は取り込まない', () => {
    const body = [
      ORDER_CONFIRMATION_GREETING,
      '',
      '注文番号: 250-5555555-5555555',
      '',
      '* 金額の無い商品',
      '  数量: 1',
      '',
      '* 金額のある商品',
      '  数量: 1',
      '  1000 JPY',
      '',
      '合計 1000 JPY',
    ].join('\n')

    const result = parse({ body })

    expect(result.kind).toBe('order_confirmation')
    if (result.kind !== 'order_confirmation') return
    expect(result.order.products.map(p => p.productName)).toEqual(['金額のある商品'])
  })

  it('文字化けした本文は文字化けとして失敗する', () => {
    const result = parse({
      body: `${ORDER_CONFIRMATION_GREETING}\n注文番号: 250-6666666-6666666\n* 商�品\n  数量: 1\n  100 JPY`,
    })

    expect(result).toMatchObject({ kind: 'parse_failure', reason: 'garbled_text' })
  })

  it('桁が壊れて数字を含まない金額は 0 円として通さない', () => {
    const body = [
      ORDER_CONFIRMATION_GREETING,
      '',
      '注文番号: 250-7777777-7777777',
      '',
      '* 商品名',
      '  数量: 1',
      '  ,,, JPY',
      '',
      '合計 ,,, JPY',
    ].join('\n')

    expect(parse({ body })).toMatchObject({
      kind: 'parse_failure',
      reason: 'missing_required_field',
    })
  })

  it('商品名が極端に長い本文は取り込まない（メール本文がそのまま家計簿に入らない）', () => {
    const body = [
      ORDER_CONFIRMATION_GREETING,
      '',
      '注文番号: 250-8888888-8888888',
      '',
      `* ${'あ'.repeat(201)}`,
      '  数量: 1',
      '  1000 JPY',
      '',
      '合計 1000 JPY',
    ].join('\n')

    expect(parse({ body })).toMatchObject({
      kind: 'parse_failure',
      reason: 'missing_required_field',
    })
  })

  it('0 円の注文（ギフト券などで全額まかなった注文）はそのまま 0 円として読む', () => {
    const body = [
      ORDER_CONFIRMATION_GREETING,
      '',
      '注文番号: 250-9999999-9999999',
      '',
      '* ギフト券で買った商品',
      '  数量: 1',
      '  0 JPY',
      '',
      'ご請求額: 0 JPY',
    ].join('\n')

    const result = parse({ body })

    // 金額を勝手に変えない。カードに請求が起きないため突合の相手にしないのは突合側の判断
    expect(result.kind).toBe('order_confirmation')
    if (result.kind !== 'order_confirmation') return
    expect(result.order.orderTotal).toBe(0)
  })

  it('例外を投げず、空の本文でも注文確認以外として返す（1 通の異常で取込を止めない）', () => {
    expect(() => parse({ body: '' })).not.toThrow()
    expect(parse({ body: '' })).toMatchObject({ kind: 'not_order_confirmation' })
  })
})

describe('parseAmazonOrderConfirmationMail: 注文確認以外の Amazon メールをパース失敗と区別する（#624）', () => {
  it('注文確認メールの目印（挨拶文）が無い本文は、注文番号を含んでいてもパース失敗にしない', () => {
    // 発送のお知らせを模した本文。注文確認と同じく注文番号を含むが、挨拶文は無い
    const body = [
      'ご注文の商品を発送いたしました。',
      '',
      '注文番号: 250-1234567-1234567',
      '',
      '* マスタリングTCP/IP―入門編―(第6版)',
      '',
      'お届け予定日: 2026年7月17日',
    ].join('\n')

    const result = parse({ body })

    expect(result.kind).not.toBe('parse_failure')
    expect(result).toMatchObject({
      kind: 'not_order_confirmation',
      gmailMessageId: 'gm_amazon_1',
      detectedAt: AT,
    })
  })

  it('注文番号すら含まないお知らせメール（レビュー依頼等）も注文確認以外として返す', () => {
    const body = ['ご購入いただいた商品はいかがでしたか？', '', 'レビューを投稿する'].join('\n')

    const result = parse({ body })

    expect(result).toMatchObject({ kind: 'not_order_confirmation' })
  })

  it('注文確認以外は例外を投げない', () => {
    expect(() => parse({ body: '発送のお知らせ' })).not.toThrow()
  })
})
