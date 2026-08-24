/**
 * Amazon 注文とカード利用通知の突合（08a §2）のテスト。
 *
 * 突合の要点は「結び付けること」より「誤って結び付けないこと」なので、金額違い・期限外・
 * 一意に決まらない組み合わせを突合しないことを否定形で押さえる。
 */
import { describe, it, expect } from 'vitest'
import {
  amazonMatchDeadlineBefore,
  amazonMatchWindowOf,
  judgeAmazonFirstTimeout,
  judgeSmbcFirstTimeout,
  matchAmazonOrders,
} from '../../../src/transaction-import/services/matchAmazonOrders'
import { TransactionCandidateSchema } from '../../../src/transaction-import/aggregates/TransactionCandidate'
import type { NormalTransactionCandidate } from '../../../src/transaction-import/aggregates/TransactionCandidate'
import type { AmazonOrderInfo } from '../../../src/transaction-import/value-objects/AmazonOrderInfo'

const ORDERED_AT = new Date('2026-07-15T09:53:00+09:00')
/**
 * #391 で確定した「双方向 3 日」をリテラルで固定する。実装の定数から期限を計算すると、
 * 期限が 3 日から動いてもテストが自己整合してしまい、仕様の変更に気づけない。
 */
const DEADLINE_AFTER = new Date('2026-07-18T09:53:00+09:00')
const DEADLINE_BEFORE = new Date('2026-07-12T09:53:00+09:00')

function order(overrides: Partial<AmazonOrderInfo> = {}): AmazonOrderInfo {
  return {
    amazonOrderId: '250-1234567-1234567' as never,
    userId: 'user_honey' as never,
    gmailMessageId: 'gm_amazon_1' as never,
    orderedAt: ORDERED_AT,
    orderTotal: 2420 as never,
    products: [{ productName: '本', productAmount: 2420 as never }],
    ...overrides,
  }
}

function candidate(
  id: string,
  overrides: { amount?: number; occurredAt?: Date; merchantName?: string } = {},
): NormalTransactionCandidate {
  return TransactionCandidateSchema.parse({
    kind: 'normal',
    common: {
      transactionCandidateId: id,
      userId: 'user_honey',
      importSource: { kind: 'email', gmailMessageId: `gm_smbc_${id}` },
      merchantName: overrides.merchantName ?? 'AMAZON CO JP',
      amount: overrides.amount ?? 2420,
      occurredAt: overrides.occurredAt ?? new Date('2026-07-15T14:37:00+09:00'),
    },
  }) as NormalTransactionCandidate
}

describe('matchAmazonOrders: 金額とタイミングで一意に決まる組み合わせだけを突合する', () => {
  it('金額が一致し数時間後に届いたカード利用通知と突合する（実測どおりの組み合わせ）', () => {
    const target = candidate('01CND000000000000000000001')

    const outcomes = matchAmazonOrders({ orders: [order()], cardUsageCandidates: [target] })

    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]).toMatchObject({ kind: 'matched', candidate: target })
  })

  it('カード利用通知が先に届いていても突合する（双方向 3 日）', () => {
    const earlier = candidate('01CND000000000000000000002', {
      occurredAt: new Date('2026-07-13T09:53:00+09:00'),
    })

    const outcomes = matchAmazonOrders({ orders: [order()], cardUsageCandidates: [earlier] })

    expect(outcomes[0]?.kind).toBe('matched')
  })

  it('金額が 1 円でも違えば突合しない（保留になる）', () => {
    const different = candidate('01CND000000000000000000003', { amount: 2421 })

    const outcomes = matchAmazonOrders({ orders: [order()], cardUsageCandidates: [different] })

    expect(outcomes[0]).toMatchObject({
      kind: 'pending',
      pending: { reason: 'card_usage_not_arrived' },
    })
  })

  it('加盟店名が Amazon でない候補とは、金額が一致しても突合しない', () => {
    const other = candidate('01CND000000000000000000004', { merchantName: 'スーパーA' })

    const outcomes = matchAmazonOrders({ orders: [order()], cardUsageCandidates: [other] })

    expect(outcomes[0]?.kind).toBe('pending')
  })

  it('注文の 3 日後ちょうどまでは突合し、1 ミリ秒でも過ぎれば突合しない', () => {
    const justInside = candidate('01CND000000000000000000005', { occurredAt: DEADLINE_AFTER })
    const justOutside = candidate('01CND000000000000000000006', {
      occurredAt: new Date('2026-07-18T09:53:00.001+09:00'),
    })

    expect(
      matchAmazonOrders({ orders: [order()], cardUsageCandidates: [justInside] })[0]?.kind,
    ).toBe('matched')
    expect(
      matchAmazonOrders({ orders: [order()], cardUsageCandidates: [justOutside] })[0]?.kind,
    ).toBe('pending')
  })

  it('注文の 3 日前ちょうどまでは突合し、1 ミリ秒でも過ぎれば突合しない', () => {
    const justInside = candidate('01CND000000000000000000013', { occurredAt: DEADLINE_BEFORE })
    const justOutside = candidate('01CND000000000000000000014', {
      occurredAt: new Date('2026-07-12T09:52:59.999+09:00'),
    })

    expect(
      matchAmazonOrders({ orders: [order()], cardUsageCandidates: [justInside] })[0]?.kind,
    ).toBe('matched')
    expect(
      matchAmazonOrders({ orders: [order()], cardUsageCandidates: [justOutside] })[0]?.kind,
    ).toBe('pending')
  })

  it('持ち主が違う候補とは、金額もタイミングも一致していても突合しない', () => {
    const spouse = TransactionCandidateSchema.parse({
      kind: 'normal',
      common: {
        transactionCandidateId: '01CND000000000000000000015',
        userId: 'user_darling',
        importSource: { kind: 'email', gmailMessageId: 'gm_smbc_spouse' },
        merchantName: 'AMAZON CO JP',
        amount: 2420,
        occurredAt: new Date('2026-07-15T14:37:00+09:00'),
      },
    }) as NormalTransactionCandidate

    const outcomes = matchAmazonOrders({ orders: [order()], cardUsageCandidates: [spouse] })

    expect(outcomes[0]?.kind).toBe('pending')
  })

  it('0 円の注文は突合しない（カードに請求が起きないため相手が存在しない）', () => {
    const zeroCandidate = candidate('01CND000000000000000000016', { amount: 0 })

    const outcomes = matchAmazonOrders({
      orders: [order({ orderTotal: 0 as never })],
      cardUsageCandidates: [zeroCandidate],
    })

    expect(outcomes[0]?.kind).toBe('pending')
  })

  it('同じ注文に当たる候補が複数あれば、どちらとも突合せず保留にする', () => {
    const outcomes = matchAmazonOrders({
      orders: [order()],
      cardUsageCandidates: [
        candidate('01CND000000000000000000007'),
        candidate('01CND000000000000000000008'),
      ],
    })

    expect(outcomes[0]).toMatchObject({ kind: 'pending', pending: { reason: 'ambiguous' } })
  })

  it('同日同金額の注文が複数あって 1 つの候補を取り合う場合、どの注文とも突合しない', () => {
    const only = candidate('01CND000000000000000000009')

    const outcomes = matchAmazonOrders({
      orders: [order(), order({ amazonOrderId: '250-9999999-9999999' as never })],
      cardUsageCandidates: [only],
    })

    expect(outcomes.map(o => o.kind)).toEqual(['pending', 'pending'])
    expect(outcomes.every(o => o.kind === 'pending' && o.pending.reason === 'ambiguous')).toBe(true)
  })

  it('金額が違う注文が並んでいても、一意に決まる組み合わせは突合する', () => {
    const forFirst = candidate('01CND000000000000000000010')
    const forSecond = candidate('01CND000000000000000000011', { amount: 980 })

    const outcomes = matchAmazonOrders({
      orders: [
        order(),
        order({ amazonOrderId: '250-8888888-8888888' as never, orderTotal: 980 as never }),
      ],
      cardUsageCandidates: [forFirst, forSecond],
    })

    expect(outcomes[0]).toMatchObject({ kind: 'matched', candidate: forFirst })
    expect(outcomes[1]).toMatchObject({ kind: 'matched', candidate: forSecond })
  })

  it('保留にはタイムアウト期限（受信から 3 日）が載る', () => {
    const outcomes = matchAmazonOrders({ orders: [order()], cardUsageCandidates: [] })

    expect(outcomes[0]).toMatchObject({
      kind: 'pending',
      pending: {
        amazonOrderId: '250-1234567-1234567',
        receivedAt: ORDERED_AT,
        timeoutAt: DEADLINE_AFTER,
      },
    })
  })
})

describe('judgeAmazonFirstTimeout: Amazon 先着タイムアウト（注文情報を破棄する側）', () => {
  const pending = {
    amazonOrderId: '250-1234567-1234567' as never,
    receivedAt: ORDERED_AT,
    timeoutAt: DEADLINE_AFTER,
    reason: 'card_usage_not_arrived' as const,
  }

  it('受信から 3 日経つ 1 ミリ秒前までは待機を続ける', () => {
    expect(judgeAmazonFirstTimeout(pending, new Date('2026-07-18T09:52:59.999+09:00'))).toBe(
      'waiting',
    )
  })

  it('受信から 3 日でタイムアウト確定', () => {
    expect(judgeAmazonFirstTimeout(pending, DEADLINE_AFTER)).toBe('timeout_confirmed')
  })
})

describe('judgeSmbcFirstTimeout: SMBC 先着タイムアウト（未分類を確定する側）', () => {
  const target = candidate('01CND000000000000000000012', { occurredAt: ORDERED_AT })

  it('発生から 3 日経つ 1 ミリ秒前までは待機を続ける（注文確認メールが届く見込みがある）', () => {
    expect(judgeSmbcFirstTimeout(target, new Date('2026-07-18T09:52:59.999+09:00'))).toBe('waiting')
  })

  it('発生から 3 日でタイムアウト確定', () => {
    expect(judgeSmbcFirstTimeout(target, DEADLINE_AFTER)).toBe('timeout_confirmed')
  })
})

describe('突合の期間ヘルパー', () => {
  it('amazonMatchWindowOf は全注文の前後 3 日を包む（注文が無ければ null）', () => {
    const later = order({ orderedAt: new Date('2026-07-20T09:53:00+09:00') })

    expect(amazonMatchWindowOf([order(), later])).toEqual({
      from: DEADLINE_BEFORE,
      to: new Date('2026-07-23T09:53:00+09:00'),
    })
    expect(amazonMatchWindowOf([])).toBeNull()
  })

  it('amazonMatchDeadlineBefore は 3 日前の時刻を返す', () => {
    expect(amazonMatchDeadlineBefore(new Date('2026-07-18T09:53:00+09:00'))).toEqual(ORDERED_AT)
  })
})
