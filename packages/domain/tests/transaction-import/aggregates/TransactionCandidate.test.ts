import { describe, it, expect } from 'vitest'
import {
  TransactionCandidateSchema,
  confirmCandidate,
  confirmMatchTimeout,
  emailGmailMessageIdOf,
  matchAmazonOrder,
} from '../../../src/transaction-import/aggregates/TransactionCandidate'
import { InvariantViolationError } from '../../../src/shared/errors/DomainError'
import type {
  AmazonMatchedTransactionCandidate,
  MatchTimeoutTransactionCandidate,
  NormalTransactionCandidate,
} from '../../../src/transaction-import/aggregates/TransactionCandidate'
import { testUlid } from '../../helpers/ids'

const emailSource = { kind: 'email', gmailMessageId: 'gm_001' as never }
const amazonSource = {
  kind: 'amazon_match',
  smbcGmailMessageId: 'gm_001' as never,
  amazonOrderId: 'amz_001' as never,
}

function common(importSource: unknown) {
  return {
    transactionCandidateId: '01CND000000000000000000001' as never,
    userId: 'user_honey' as never,
    importSource,
    merchantName: 'AMAZON.CO.JP',
    amount: 2500 as never,
    occurredAt: new Date(),
  }
}

describe('TransactionCandidate 集約', () => {
  it('通常取引候補（メール由来）は parse 成功', () => {
    expect(() =>
      TransactionCandidateSchema.parse({ kind: 'normal', common: common(emailSource) }),
    ).not.toThrow()
  })

  it('PDF由来の取引候補は PDF変換ジョブID が必須（欠落で parse 失敗）', () => {
    const pdfSource = {
      kind: 'pdf',
      pdfFileId: '01F10000000000000000000001' as never,
      pageNumber: 1,
    }
    expect(() =>
      TransactionCandidateSchema.parse({ kind: 'normal', common: common(pdfSource) }),
    ).toThrow()
    expect(() =>
      TransactionCandidateSchema.parse({
        kind: 'normal',
        common: common({ ...pdfSource, pdfConversionJobId: '01PDF000000000000000000001' as never }),
      }),
    ).not.toThrow()
  })

  it('Amazon突合取引候補は取込ソース amazon_match で parse 成功', () => {
    expect(() =>
      TransactionCandidateSchema.parse({
        kind: 'amazon_matched',
        common: common(amazonSource),
        products: [
          {
            productName: 'ドメイン駆動設計',
            productAmount: 2500 as never,
          },
        ],
        matchedAt: new Date(),
      }),
    ).not.toThrow()
  })

  it('Amazon突合取引候補で取込ソースが amazon_match 以外なら parse 失敗', () => {
    expect(() =>
      TransactionCandidateSchema.parse({
        kind: 'amazon_matched',
        common: common(emailSource),
        products: [
          {
            productName: 'ドメイン駆動設計',
            productAmount: 2500 as never,
          },
        ],
        matchedAt: new Date(),
      }),
    ).toThrow()
  })

  it('Amazon突合取引候補の商品リストが空なら parse 失敗', () => {
    expect(() =>
      TransactionCandidateSchema.parse({
        kind: 'amazon_matched',
        common: common(amazonSource),
        products: [],
        matchedAt: new Date(),
      }),
    ).toThrow()
  })

  it('突合タイムアウト未分類候補（双方向）は parse 成功', () => {
    const directions = ['smbc_first_awaiting_amazon', 'amazon_first_awaiting_smbc'] as const
    for (const timeoutDirection of directions) {
      expect(() =>
        TransactionCandidateSchema.parse({
          kind: 'match_timeout',
          common: common(emailSource),
          timedOutAt: new Date(),
          timeoutDirection,
        }),
      ).not.toThrow()
    }
  })

  it('確定済み候補は parse 成功（confirmedAt + createdTransactionId 必須）', () => {
    expect(() =>
      TransactionCandidateSchema.parse({
        kind: 'confirmed',
        common: common(emailSource),
        confirmedAt: new Date(),
        createdTransactionId: testUlid('01TX'),
      }),
    ).not.toThrow()
    expect(() =>
      TransactionCandidateSchema.parse({
        kind: 'confirmed',
        common: common(emailSource),
        confirmedAt: new Date(),
      }),
    ).toThrow()
  })
})

describe('confirmCandidate 状態遷移', () => {
  const createdTransactionId = testUlid('01TX') as never
  const at = new Date('2026-07-01T00:00:00Z')

  it('normal → confirmed', () => {
    const candidate = TransactionCandidateSchema.parse({
      kind: 'normal',
      common: common(emailSource),
    }) as NormalTransactionCandidate
    const confirmed = confirmCandidate(candidate, createdTransactionId, at)
    expect(confirmed.kind).toBe('confirmed')
    expect(confirmed.common).toEqual(candidate.common)
    expect(confirmed.confirmedAt).toEqual(at)
    expect(confirmed.createdTransactionId).toBe(createdTransactionId)
  })

  it('amazon_matched → confirmed（variant 固有データは消費済みとして持ち越さない）', () => {
    const candidate = TransactionCandidateSchema.parse({
      kind: 'amazon_matched',
      common: common(amazonSource),
      products: [
        {
          productName: 'ドメイン駆動設計',
          productAmount: 2500 as never,
        },
      ],
      matchedAt: new Date(),
    }) as AmazonMatchedTransactionCandidate
    const confirmed = confirmCandidate(candidate, createdTransactionId, at)
    expect(confirmed.kind).toBe('confirmed')
    expect('products' in confirmed).toBe(false)
  })

  it('match_timeout → confirmed', () => {
    const candidate = TransactionCandidateSchema.parse({
      kind: 'match_timeout',
      common: common(emailSource),
      timedOutAt: new Date(),
      timeoutDirection: 'smbc_first_awaiting_amazon',
    }) as MatchTimeoutTransactionCandidate
    const confirmed = confirmCandidate(candidate, createdTransactionId, at)
    expect(confirmed.kind).toBe('confirmed')
  })
})

describe('TransactionCandidate: Amazon 突合の状態遷移', () => {
  const at = new Date('2026-07-16T00:00:00+09:00')
  const order = {
    amazonOrderId: '250-1234567-1234567' as never,
    products: [{ productName: 'マスタリングTCP/IP', productAmount: 2500 as never }],
  }

  function normal(importSource: unknown = emailSource): NormalTransactionCandidate {
    return TransactionCandidateSchema.parse({
      kind: 'normal',
      common: common(importSource),
    }) as NormalTransactionCandidate
  }

  it('normal → amazon_matched: 商品名が付き、取込ソースが Amazon突合由来になる', () => {
    const candidate = normal()

    const matched = matchAmazonOrder(candidate, order, at)

    expect(matched.kind).toBe('amazon_matched')
    expect(matched.products).toEqual(order.products)
    expect(matched.matchedAt).toEqual(at)
    expect(matched.common.importSource).toEqual({
      kind: 'amazon_match',
      smbcGmailMessageId: 'gm_001',
      amazonOrderId: order.amazonOrderId,
    })
  })

  it('突合しても候補 ID・金額・発生日時は変わらない（同じ支払いの記録を増やさない）', () => {
    const candidate = normal()

    const matched = matchAmazonOrder(candidate, order, at)

    expect(matched.common.transactionCandidateId).toBe(candidate.common.transactionCandidateId)
    expect(matched.common.amount).toBe(candidate.common.amount)
    expect(matched.common.occurredAt).toEqual(candidate.common.occurredAt)
  })

  it('メール由来でない候補は突合できない（不変条件違反）', () => {
    const csvSource = { kind: 'csv', csvFileId: '01F10000000000000000000001', rowNumber: 1 }

    expect(() => matchAmazonOrder(normal(csvSource), order, at)).toThrow(InvariantViolationError)
  })

  it('normal → match_timeout: タイムアウト方向と到達日時が残り、取込ソースは元のまま', () => {
    const candidate = normal()

    const timedOut = confirmMatchTimeout(candidate, 'smbc_first_awaiting_amazon', at)

    expect(timedOut.kind).toBe('match_timeout')
    expect(timedOut.timedOutAt).toEqual(at)
    expect(timedOut.timeoutDirection).toBe('smbc_first_awaiting_amazon')
    expect(timedOut.common.importSource).toEqual(emailSource)
  })

  it('emailGmailMessageIdOf: メール由来なら出所を返し、それ以外は不変条件違反', () => {
    expect(emailGmailMessageIdOf(normal())).toBe('gm_001')
    expect(() =>
      emailGmailMessageIdOf(
        normal({ kind: 'manual', enteredAt: new Date(), enteredByUserId: 'user_honey' }),
      ),
    ).toThrow(InvariantViolationError)
  })
})
