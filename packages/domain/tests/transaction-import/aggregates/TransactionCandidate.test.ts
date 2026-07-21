import { describe, it, expect } from 'vitest'
import {
  TransactionCandidateSchema,
  confirmCandidate,
} from '../../../src/transaction-import/aggregates/TransactionCandidate'
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
            amazonProductKey: '本' as never,
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
            amazonProductKey: '本' as never,
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
          amazonProductKey: '本' as never,
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
