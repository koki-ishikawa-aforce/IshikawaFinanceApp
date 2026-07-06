import { describe, it, expect } from 'vitest'
import { TransactionCandidateSchema } from '../../../src/transaction-import/aggregates/TransactionCandidate'

const emailSource = { kind: 'email', gmailMessageId: 'gm_001' as never }
const amazonSource = {
  kind: 'amazon_match',
  smbcGmailMessageId: 'gm_001' as never,
  amazonOrderId: 'amz_001' as never,
}

function common(importSource: unknown) {
  return {
    transactionCandidateId: 'cand_001' as never,
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
})
